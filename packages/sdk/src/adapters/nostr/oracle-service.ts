/**
 * Oracle actor Nostr workflow binding.
 *
 * Responsibilities (per README):
 *   1. Generate preimage, return hash(preimage) to Customer
 *   2. Listen for kind 7000 offers → record Provider pubkeys
 *   3. On selection announcement → verify HTLC condition, record selected Provider
 *   4. Listen for kind 6300 results → verify Provider pubkey, download blob,
 *      verify blob hash, decrypt K_O, verify C2PA
 *   5. C2PA valid → deliver preimage via NIP-44 DM (kind 4)
 *   6. C2PA invalid → deliver rejection via NIP-44 DM (kind 4)
 */

import type { Event } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { NostrIdentity } from "../../identity.ts";
import { restoreIdentity } from "../../identity.ts";
import {
  buildFrostSignatureDM,
  buildPreimageDM,
  buildRejectionDM,
} from "./events/dm.ts";
import {
  publishEvent,
  subscribeToFeedback,
  subscribeToResponses,
} from "./transport/client.ts";
import { createPreimageStore, type PreimageStore } from "../../payments/mod.ts";
import type { ThresholdOracleConfig } from "../../payments/mod.ts";
import type { FrostCoordinator } from "../../payments/mod.ts";
import type { FrostNodeConfig } from "../../payments/mod.ts";
import { coordinateSigning } from "../../payments/mod.ts";
import {
  requestToRequirement,
  resultToVerificationInput,
  verify,
} from "../../proofs/verification/verifier.ts";
import type {
  Query as VerifiableRequest,
  QueryResult as RequestSubmissionResult,
} from "../../requests/domain/types.ts";
import {
  buildQueryFromPayload,
  buildResultFromPayload,
  handleFeedbackEvent,
  parseResponsePayload,
  type WatchedQuery,
} from "./oracle-handlers.ts";

import { getLogger } from "../../internal/runtime/logger.ts";
const log = getLogger(["anchr", "oracle-nostr"]);

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
  /** Per-node FROST config with key material and peer endpoints. */
  frostNodeConfig?: FrostNodeConfig;
  /** Callback when a Provider submits an offer. */
  onOffer?: (
    requestId: string,
    providerPubkey: string,
    amountSats?: number,
  ) => void;
  /** Callback when verification completes. */
  onVerification?: (
    requestId: string,
    passed: boolean,
    providerPubkey: string,
  ) => void;
  /** Delivery retry delays in milliseconds. Defaults to 2s, 4s, then final attempt. */
  deliveryRetryDelaysMs?: number[];
}

export interface OracleNostrService {
  /** Generate a preimage for a request and return the hash. */
  generateRequestHash(requestId: string): { hash: string };
  /** Start watching a request for offers and results. */
  watchRequest(
    requestId: string,
    requestEventId: string,
    customerPubkey: string,
  ): void;
  /** Record the selected Provider pubkey for a request. */
  recordSelectedProvider(requestId: string, providerPubkey: string): void;
  /** Verify a result and deliver preimage or rejection. */
  verifyAndDeliver(
    requestId: string,
    request: VerifiableRequest,
    result: RequestSubmissionResult,
    providerPubkey: string,
  ): Promise<boolean>;
  /** Verify and deliver using FROST signing (P2PK+FROST flow). */
  verifyAndDeliverWithFrost(
    requestId: string,
    request: VerifiableRequest,
    result: RequestSubmissionResult,
    providerPubkey: string,
  ): Promise<boolean>;
  /** Stop watching all requests. */
  stop(): void;
}

export function createOracleNostrService(
  config: OracleNostrServiceConfig,
): OracleNostrService {
  const preimageStore = config.preimageStore ?? createPreimageStore();
  const watched = new Map<string, WatchedQuery>();
  const queryHashMap = new Map<string, string>();

  async function handleResponseEvent(queryId: string, event: Event) {
    const entry = watched.get(queryId);
    if (!entry) return;

    if (
      entry.selectedProviderPubkey &&
      event.pubkey !== entry.selectedProviderPubkey
    ) {
      log.error(`Ignoring result from non-selected Provider ${event.pubkey}`);
      return;
    }

    try {
      const oraclePayload = parseResponsePayload(config.identity, event);
      if (!oraclePayload) {
        log.error(`No oracle_payload tag in result for ${queryId}`);
        return;
      }

      const query = buildQueryFromPayload(queryId, oraclePayload);
      const result = buildResultFromPayload(oraclePayload);
      const passed = await verifyAndDeliverInternal(
        queryId,
        query,
        result,
        event.pubkey,
      );
      config.onVerification?.(queryId, passed, event.pubkey);
    } catch (error) {
      log.error(`Failed to process result for ${queryId}:`, error);
    }
  }

  async function verifyAndDeliverInternal(
    queryId: string,
    query: VerifiableRequest,
    result: RequestSubmissionResult,
    providerPubkey: string,
  ): Promise<boolean> {
    const detail = await _verifyFn(query, result);
    const hash = queryHashMap.get(queryId);
    const preimage = hash ? preimageStore.getPreimage(hash) : null;

    if (detail.passed && preimage && hash) {
      const dm = buildPreimageDM(
        config.identity,
        providerPubkey,
        queryId,
        preimage,
      );

      const retryDelaysMs = config.deliveryRetryDelaysMs ?? [2000, 4000];
      const maxAttempts = retryDelaysMs.length + 1;
      let delivered = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const publishResult = await _publishEventFn(dm, config.relayUrls);
        if (publishResult.successes.length > 0) {
          log.error(
            `Preimage delivered to Provider for ${queryId} (${publishResult.successes.length} relay(s))`,
          );
          delivered = true;
          break;
        }
        const delayMs = retryDelaysMs[attempt - 1];
        if (delayMs !== undefined) {
          log.error(
            `Preimage delivery failed for ${queryId} (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      if (delivered) {
        preimageStore.delete(hash);
        queryHashMap.delete(queryId);
      } else {
        log.error(
          `Preimage delivery failed for ${queryId} after ${maxAttempts} attempts — preimage retained for Nostr retry`,
        );
        return false;
      }
      return true;
    } else {
      const reason = detail.failures.join(", ") || "Verification failed";
      const dm = buildRejectionDM(
        config.identity,
        providerPubkey,
        queryId,
        reason,
      );
      await _publishEventFn(dm, config.relayUrls);
      log.error(`Rejection sent to Provider for ${queryId}: ${reason}`);
      return false;
    }
  }

  return {
    generateRequestHash(queryId: string) {
      const entry = preimageStore.create();
      queryHashMap.set(queryId, entry.hash);
      return { hash: entry.hash };
    },

    watchRequest(
      queryId: string,
      queryEventId: string,
      customerPubkey: string,
    ) {
      const entry: WatchedQuery = {
        queryId,
        queryEventId,
        customerPubkey,
        offeredProviders: new Set(),
        subs: [],
      };

      const feedbackSub = subscribeToFeedback(
        queryEventId,
        (event) =>
          handleFeedbackEvent(
            config.identity,
            watched,
            queryId,
            event,
            config.onOffer,
          ),
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

    recordSelectedProvider(queryId: string, providerPubkey: string) {
      const entry = watched.get(queryId);
      if (entry) {
        entry.selectedProviderPubkey = providerPubkey;
      }
    },

    async verifyAndDeliver(queryId, query, result, providerPubkey) {
      if (query.quorum && config.frostCoordinator && config.frostConfig) {
        return this.verifyAndDeliverWithFrost(
          queryId,
          query,
          result,
          providerPubkey,
        );
      }
      return verifyAndDeliverInternal(queryId, query, result, providerPubkey);
    },

    async verifyAndDeliverWithFrost(queryId, query, result, providerPubkey) {
      if (!config.frostNodeConfig) {
        log.error(`FROST node config not available, falling back to HTLC`);
        return verifyAndDeliverInternal(queryId, query, result, providerPubkey);
      }

      const detail = await _verifyFn(query, result);
      if (!detail.passed) {
        const reason = detail.failures.join(", ") || "Verification failed";
        const dm = buildRejectionDM(
          config.identity,
          providerPubkey,
          queryId,
          reason,
        );
        await _publishEventFn(dm, config.relayUrls);
        log.error(`Rejection sent to Provider for ${queryId}: ${reason}`);
        return false;
      }

      // Step 2: Coordinate FROST signing with peer Oracle nodes.
      // Each peer's /frost/signer/round1 endpoint independently verifies before signing.
      // Peers that fail verification will refuse to participate → below threshold = no signature.
      const messageHex = bytesToHex(
        sha256(new TextEncoder().encode(`anchr:sign:${queryId}`)),
      );

      const sigResult = await coordinateSigning(
        {
          nodeConfig: config.frostNodeConfig,
          requirement: requestToRequirement(query),
          input: resultToVerificationInput(result),
        },
        messageHex,
      );

      if (!sigResult) {
        log.error(`FROST signing failed for ${queryId} — threshold not met`);
        const dm = buildRejectionDM(
          config.identity,
          providerPubkey,
          queryId,
          "FROST threshold not met — insufficient Oracle approvals",
        );
        await _publishEventFn(dm, config.relayUrls);
        return false;
      }

      // Step 3: Deliver FROST group signature to Provider
      const dm = buildFrostSignatureDM(
        config.identity,
        providerPubkey,
        queryId,
        sigResult.signature,
        config.frostNodeConfig.group_pubkey,
      );
      const publishResult = await _publishEventFn(dm, config.relayUrls);
      if (publishResult.successes.length > 0) {
        log.error(
          `FROST signature delivered to Provider for ${queryId} (signers: ${
            sigResult.signers_participated.join(",")
          })`,
        );
        return true;
      }
      log.error(`FROST signature delivery failed for ${queryId}`);
      return false;
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
  const secretKeyHex = Deno.env.get("ORACLE_NOSTR_SECRET_KEY")?.trim();
  if (!secretKeyHex) return null;

  const identity = restoreIdentity(secretKeyHex);
  const relayUrls = Deno.env.get("NOSTR_RELAYS")?.split(",").map((u) =>
    u.trim()
  ).filter(Boolean);

  return createOracleNostrService({ identity, relayUrls });
}
