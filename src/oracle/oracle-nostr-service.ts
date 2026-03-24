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
import type { SubCloser } from "nostr-tools/pool";
import type { NostrIdentity } from "../nostr/identity";
import { restoreIdentity } from "../nostr/identity";
import {
  ANCHR_QUERY_FEEDBACK,
  ANCHR_QUERY_RESPONSE,
  parseOracleResponsePayload,
  parseFeedbackPayload,
  type QuoteFeedbackPayload,
  type OracleResponsePayload,
} from "../nostr/events";
import { buildPreimageDM, buildRejectionDM } from "../nostr/dm";
import {
  publishEvent,
  subscribeToFeedback,
  subscribeToResponses,
} from "../nostr/client";
import { createPreimageStore, type PreimageStore } from "./preimage-store";
import { verify } from "../verification/verifier";
import type { Query, QueryResult } from "../types";

export interface OracleNostrServiceConfig {
  /** Oracle's persistent Nostr identity (loaded from secret key). */
  identity: NostrIdentity;
  /** Relay URLs to subscribe to. */
  relayUrls?: string[];
  /** Preimage store instance (default: in-memory). */
  preimageStore?: PreimageStore;
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
  /** Stop watching all queries. */
  stop(): void;
}

interface WatchedQuery {
  queryId: string;
  queryEventId: string;
  requesterPubkey: string;
  selectedWorkerPubkey?: string;
  quotedWorkers: Set<string>;
  subs: SubCloser[];
}

export function createOracleNostrService(config: OracleNostrServiceConfig): OracleNostrService {
  const preimageStore = config.preimageStore ?? createPreimageStore();
  const watched = new Map<string, WatchedQuery>();

  function handleFeedbackEvent(queryId: string, event: Event) {
    const entry = watched.get(queryId);
    if (!entry) return;

    try {
      const payload = parseFeedbackPayload(
        event.content,
        config.identity.secretKey,
        event.pubkey,
      );

      if (payload.status === "payment-required") {
        const quote = payload as QuoteFeedbackPayload;
        entry.quotedWorkers.add(quote.worker_pubkey);
        config.onQuote?.(queryId, quote.worker_pubkey, quote.amount_sats);
      }
    } catch {
      // Cannot decrypt — event not for us, ignore
    }
  }

  async function handleResponseEvent(queryId: string, event: Event) {
    const entry = watched.get(queryId);
    if (!entry) return;

    // Verify the sender is the selected Worker
    if (entry.selectedWorkerPubkey && event.pubkey !== entry.selectedWorkerPubkey) {
      console.error(`[oracle-nostr] Ignoring result from non-selected Worker ${event.pubkey}`);
      return;
    }

    try {
      // Parse Oracle-specific payload from tags (NIP-44 encrypted to Oracle)
      const oraclePayload = parseOracleResponsePayload(event, config.identity.secretKey);
      if (!oraclePayload) {
        console.error(`[oracle-nostr] No oracle_payload tag in result for ${queryId}`);
        return;
      }

      // Build a minimal Query and QueryResult for verification
      const query: Query = {
        id: queryId,
        status: "processing",
        description: "",
        challenge_nonce: oraclePayload.nonce_echo,
        challenge_rule: "",
        verification_requirements: ["gps", "ai_check"],
        created_at: 0,
        expires_at: Date.now() + 600_000,
        payment_status: "htlc_swapped",
      };

      // Map Oracle payload attachments to QueryResult attachments
      const result: QueryResult = {
        attachments: (oraclePayload.attachments ?? []).map((a) => ({
          id: a.blossom_hash,
          uri: a.blossom_urls[0] ?? "",
          mime_type: a.mime,
          storage_kind: "blossom" as const,
          blossom_hash: a.blossom_hash,
          blossom_servers: a.blossom_urls,
        })),
        notes: oraclePayload.notes,
      };

      const passed = await verifyAndDeliverInternal(
        queryId,
        query,
        result,
        event.pubkey,
      );

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
    const detail = await verify(query, result);
    const preimage = preimageStore.getPreimage(queryId);

    if (detail.passed && preimage) {
      // C2PA valid → deliver preimage via NIP-44 DM
      const dm = buildPreimageDM(config.identity, workerPubkey, queryId, preimage);
      const publishResult = await publishEvent(dm, config.relayUrls);
      if (publishResult.successes.length > 0) {
        console.error(`[oracle-nostr] Preimage delivered to Worker for ${queryId}`);
      }
      preimageStore.delete(queryId);
      return true;
    } else {
      // C2PA invalid → deliver rejection
      const reason = detail.failures.join(", ") || "Verification failed";
      const dm = buildRejectionDM(config.identity, workerPubkey, queryId, reason);
      await publishEvent(dm, config.relayUrls);
      console.error(`[oracle-nostr] Rejection sent to Worker for ${queryId}: ${reason}`);
      return false;
    }
  }

  return {
    generateHash(queryId: string) {
      const entry = preimageStore.create(queryId);
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

      // Subscribe to kind 7000 feedback (quotes, selection)
      const feedbackSub = subscribeToFeedback(
        queryEventId,
        (event) => handleFeedbackEvent(queryId, event),
        config.relayUrls,
      );
      entry.subs.push(feedbackSub);

      // Subscribe to kind 6300 results
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
      return verifyAndDeliverInternal(queryId, query, result, workerPubkey);
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
