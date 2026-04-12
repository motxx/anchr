/**
 * Oracle Nostr service — Nostr-native Oracle for the HTLC flow.
 *
 * Responsibilities (per README):
 *   1. Generate preimage, return hash(preimage) to Requester
 *   2. Listen for kind 7000 quotes → record Worker pubkeys
 *   3. On selection announcement → verify HTLC condition, record selected Worker
 *   4. Listen for kind 6300 results → verify Worker pubkey, download blob,
 *      verify blob hash, decrypt K_O, verify C2PA
 *   5. C2PA valid → deliver preimage via NIP-44 DM (kind 4)
 *   6. C2PA invalid → deliver rejection via NIP-44 DM (kind 4)
 */

import type { Event } from "nostr-tools";
import type { NostrIdentity } from "../nostr/identity";
import { restoreIdentity } from "../nostr/identity";
import { buildPreimageDM, buildRejectionDM, buildFrostSignatureDM } from "../nostr/dm";
import {
  publishEvent,
  subscribeToFeedback,
  subscribeToResponses,
} from "../nostr/client";
import { createPreimageStore, type PreimageStore } from "../preimage/preimage-store";
import type { ThresholdOracleConfig } from "../../domain/oracle-types";
import type { FrostCoordinator } from "../frost/coordinator";
import type { FrostSigningSession } from "../frost/types";
import { verify } from "../verification/verifier";
import type { Query, QueryResult } from "../../domain/types";
import {
  type WatchedQuery,
  buildQueryFromPayload,
  buildResultFromPayload,
  handleFeedbackEvent,
  parseResponsePayload,
} from "./oracle-nostr-handlers";

/** Module-level seam for testing — matches _setValidateTlsnForTest pattern. */
let _publishEventFn: typeof publishEvent = publishEvent;
let _verifyFn: typeof verify = verify;

/** Allow tests to override the publishEvent implementation. Pass null to reset. */
export function _setPublishEventForTest(fn: typeof publishEvent | null): void {
  _publishEventFn = fn ?? publishEvent;
}

/** Allow tests to override the verify implementation. Pass null to reset. */
export function _setVerifyForTest(fn: typeof verify | null): void {
  _verifyFn = fn ?? verify;
}

export interface OracleNostrServiceConfig {
  /** Oracle's persistent Nostr identity (loaded from secret key). */
  identity: NostrIdentity;
  /** Relay URLs to subscribe to. */
  relayUrls?: string[];
  /** Preimage store instance (default: in-memory). */
  preimageStore?: PreimageStore;
  /** FROST coordinator for threshold signing (optional — enables P2PK+FROST flow). */
  frostCoordinator?: FrostCoordinator;
  /** FROST threshold oracle config (required when frostCoordinator is set). */
  frostConfig?: ThresholdOracleConfig;
  /** Callback when a Worker submits a quote. */
  onQuote?: (queryId: string, workerPubkey: string, amountSats?: number) => void;
  /** Callback when verification completes. */
  onVerification?: (queryId: string, passed: boolean, workerPubkey: string) => void;
}

export interface OracleNostrService {
  /** Generate a preimage for a query and return the hash. */
  generateHash(queryId: string): { hash: string };
  /** Start watching a query for quotes and results. */
  watchQuery(queryId: string, queryEventId: string, requesterPubkey: string): void;
  /** Record the selected Worker pubkey for a query. */
  recordSelectedWorker(queryId: string, workerPubkey: string): void;
  /** Verify a result and deliver preimage or rejection. */
  verifyAndDeliver(queryId: string, query: Query, result: QueryResult, workerPubkey: string): Promise<boolean>;
  /** Verify and deliver using FROST signing (P2PK+FROST flow). */
  verifyAndDeliverFrost(queryId: string, query: Query, result: QueryResult, workerPubkey: string): Promise<boolean>;
  /** Stop watching all queries. */
  stop(): void;
}

export function createOracleNostrService(config: OracleNostrServiceConfig): OracleNostrService {
  const preimageStore = config.preimageStore ?? createPreimageStore();
  const watched = new Map<string, WatchedQuery>();
  const queryHashMap = new Map<string, string>();

  async function handleResponseEvent(queryId: string, event: Event) {
    const entry = watched.get(queryId);
    if (!entry) return;

    if (entry.selectedWorkerPubkey && event.pubkey !== entry.selectedWorkerPubkey) {
      console.error(`[oracle-nostr] Ignoring result from non-selected Worker ${event.pubkey}`);
      return;
    }

    try {
      const oraclePayload = parseResponsePayload(config.identity, event);
      if (!oraclePayload) {
        console.error(`[oracle-nostr] No oracle_payload tag in result for ${queryId}`);
        return;
      }

      const query = buildQueryFromPayload(queryId, oraclePayload);
      const result = buildResultFromPayload(oraclePayload);
      const passed = await verifyAndDeliverInternal(queryId, query, result, event.pubkey);
      config.onVerification?.(queryId, passed, event.pubkey);
    } catch (error) {
      console.error(`[oracle-nostr] Failed to process result for ${queryId}:`, error);
    }
  }

  async function verifyAndDeliverInternal(
    queryId: string,
    query: Query,
    result: QueryResult,
    workerPubkey: string,
  ): Promise<boolean> {
    const detail = await _verifyFn(query, result);
    const hash = queryHashMap.get(queryId);
    const preimage = hash ? preimageStore.getPreimage(hash) : null;

    if (detail.passed && preimage && hash) {
      const dm = buildPreimageDM(config.identity, workerPubkey, queryId, preimage);
      const publishResult = await _publishEventFn(dm, config.relayUrls);
      if (publishResult.successes.length > 0) {
        console.error(`[oracle-nostr] Preimage delivered to Worker for ${queryId}`);
      }
      preimageStore.delete(hash);
      queryHashMap.delete(queryId);
      return true;
    } else {
      const reason = detail.failures.join(", ") || "Verification failed";
      const dm = buildRejectionDM(config.identity, workerPubkey, queryId, reason);
      await _publishEventFn(dm, config.relayUrls);
      console.error(`[oracle-nostr] Rejection sent to Worker for ${queryId}: ${reason}`);
      return false;
    }
  }

  return {
    generateHash(queryId: string) {
      const entry = preimageStore.create();
      queryHashMap.set(queryId, entry.hash);
      return { hash: entry.hash };
    },

    watchQuery(queryId: string, queryEventId: string, requesterPubkey: string) {
      const entry: WatchedQuery = {
        queryId,
        queryEventId,
        requesterPubkey,
        quotedWorkers: new Set(),
        subs: [],
      };

      const feedbackSub = subscribeToFeedback(
        queryEventId,
        (event) => handleFeedbackEvent(config.identity, watched, queryId, event, config.onQuote),
        config.relayUrls,
      );
      entry.subs.push(feedbackSub);

      const responseSub = subscribeToResponses(
        queryEventId,
        (event) => handleResponseEvent(queryId, event),
        config.relayUrls,
      );
      entry.subs.push(responseSub);

      watched.set(queryId, entry);
    },

    recordSelectedWorker(queryId: string, workerPubkey: string) {
      const entry = watched.get(queryId);
      if (entry) {
        entry.selectedWorkerPubkey = workerPubkey;
      }
    },

    async verifyAndDeliver(queryId, query, result, workerPubkey) {
      // Auto-dispatch: quorum + FROST configured → threshold signing; otherwise → single Oracle HTLC
      if (query.quorum && config.frostCoordinator && config.frostConfig) {
        return this.verifyAndDeliverFrost(queryId, query, result, workerPubkey);
      }
      return verifyAndDeliverInternal(queryId, query, result, workerPubkey);
    },

    async verifyAndDeliverFrost(queryId, query, result, workerPubkey) {
      if (!config.frostCoordinator || !config.frostConfig) {
        console.error(`[oracle-nostr] FROST not configured, falling back to HTLC`);
        return verifyAndDeliverInternal(queryId, query, result, workerPubkey);
      }

      const detail = await _verifyFn(query, result);

      if (detail.passed) {
        // Start FROST signing session
        // The message is the SIG_ALL hash of the Cashu proofs that need to be signed
        const message = queryId; // Placeholder — real impl uses proof serialization
        const session = config.frostCoordinator.startSigning(queryId, message, config.frostConfig);

        // In a full implementation, the coordinator would wait for threshold signers
        // to submit nonce commitments and signature shares via the /frost/sign/* API.
        // For now, we check if the session already has enough signatures.
        const aggResult = await config.frostCoordinator.tryAggregate(session.session_id);

        if (aggResult?.signature) {
          const dm = buildFrostSignatureDM(
            config.identity,
            workerPubkey,
            queryId,
            aggResult.signature,
            config.frostConfig.group_pubkey,
          );
          const publishResult = await _publishEventFn(dm, config.relayUrls);
          if (publishResult.successes.length > 0) {
            console.error(`[oracle-nostr] FROST signature delivered to Worker for ${queryId}`);
          }
          return true;
        }

        // Session started but awaiting signer participation
        console.error(`[oracle-nostr] FROST signing session started for ${queryId}, awaiting signers`);
        return true;
      } else {
        const reason = detail.failures.join(", ") || "Verification failed";
        const dm = buildRejectionDM(config.identity, workerPubkey, queryId, reason);
        await _publishEventFn(dm, config.relayUrls);
        console.error(`[oracle-nostr] Rejection sent to Worker for ${queryId}: ${reason}`);
        return false;
      }
    },

    stop() {
      for (const entry of watched.values()) {
        for (const sub of entry.subs) {
          sub.close();
        }
      }
      watched.clear();
    },
  };
}

/**
 * Create an Oracle Nostr service from environment variable.
 */
export function createOracleNostrServiceFromEnv(): OracleNostrService | null {
  const secretKeyHex = process.env.ORACLE_NOSTR_SECRET_KEY?.trim();
  if (!secretKeyHex) return null;

  const identity = restoreIdentity(secretKeyHex);
  const relayUrls = process.env.NOSTR_RELAYS?.split(",").map((u) => u.trim()).filter(Boolean);

  return createOracleNostrService({ identity, relayUrls });
}
