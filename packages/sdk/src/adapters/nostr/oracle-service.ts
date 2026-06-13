/**
 * Oracle actor Nostr workflow binding.
 *
 * Responsibilities (per README):
 *   1. Generate preimage, return hash(preimage) to Customer
 *   2. Listen for kind 7000 offers → record Provider pubkeys
 *   3. On selection announcement → verify HTLC condition, record selected Provider
 *   4. Listen for kind 6300 results → verify Provider pubkey, download blob,
 *      verify blob hash, decrypt K_O, verify schema evidence
 *   5. Evidence valid → deliver preimage via NIP-44 DM (kind 4)
 *   6. Evidence invalid → deliver rejection via NIP-44 DM (kind 4)
 *
 * Process concerns are the host's responsibility: wire SIGTERM/SIGINT to
 * `service.stop()`, expose a health surface, and call
 * `QueryService.expireQueries()` on a schedule if a request store is
 * composed alongside the daemon.
 */

import type { Event } from "nostr-tools";
import type { NostrIdentity } from "../../identity.ts";
import { restoreIdentity } from "../../identity.ts";
import {
  buildFrostSignatureDM,
  buildPreimageDM,
  buildRejectionDM,
} from "./events/dm.ts";
import { createRelayClient } from "./client.ts";
import type { RelayClient } from "../types.ts";
import { serveHashRequests } from "./hash-responder.ts";
import {
  createPreimageStore,
  issueQueryHash,
  type PreimageStore,
} from "../../payments/mod.ts";
import type { ThresholdOracleConfig } from "../../payments/mod.ts";
import type { FrostCoordinator } from "../../payments/mod.ts";
import type { FrostNodeConfig } from "../../payments/mod.ts";
import {
  coordinateSigning,
  deriveFrostP2pkMessages,
  deriveFrostSigningMessage,
} from "../../payments/mod.ts";
import {
  requestToRequirement,
  resultToVerificationInput,
  verify,
} from "../../requests/application/query-verifier.ts";
import type {
  Query as VerifiableRequest,
  QueryResult as RequestSubmissionResult,
} from "../../requests/domain/types.ts";
import { parseOracleQueryResponseEvent } from "@anchr/protocol/events";
import {
  handleFeedbackEvent,
  oracleResponseToResult,
  type WatchedQuery,
} from "./oracle-handlers.ts";

import { getLogger } from "../../internal/runtime/logger.ts";
const log = getLogger(["anchr", "oracle-nostr"]);

export interface OracleNostrServiceConfig {
  /** Oracle's persistent Nostr identity (loaded from secret key). */
  identity: NostrIdentity;
  /** Relay transport the daemon listens and answers on. */
  relayClient: RelayClient;
  /** Proof verifier (defaults to the real verifier). Tests inject doubles. */
  verify?: typeof verify;
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
  /**
   * Start watching a request for offers and results. The caller supplies the
   * real `Query` — its verification requirements are what relay-submitted
   * results are verified against.
   */
  watchRequest(
    request: VerifiableRequest,
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

/**
 * Result of one verify-and-deliver pass. `terminal` marks states where the
 * request needs no further relay watching (delivered or rejected); delivery
 * failures stay non-terminal so a retry can still settle.
 */
interface DeliveryOutcome {
  passed: boolean;
  terminal: boolean;
}

export function createOracleNostrService(
  config: OracleNostrServiceConfig,
): OracleNostrService {
  const preimageStore = config.preimageStore ?? createPreimageStore();
  const relayClient = config.relayClient;
  const verifyFn = config.verify ?? verify;
  const watched = new Map<string, WatchedQuery>();
  const queryHashMap = new Map<string, string>();

  function issueHash(queryId: string): string {
    return issueQueryHash(preimageStore, queryHashMap, queryId).hash;
  }

  const hashResponder = serveHashRequests({
    relayClient,
    identity: config.identity,
    issueHash,
  });

  async function handleResponseEvent(queryId: string, event: Event) {
    const entry = watched.get(queryId);
    if (!entry) return;

    // Fail closed: release material only ever flows toward the recorded
    // selected Provider. With no selection recorded, results are ignored.
    if (!entry.selectedProviderPubkey) {
      log.warn(
        `Ignoring result for ${queryId}: no selected Provider recorded`,
      );
      return;
    }
    if (event.pubkey !== entry.selectedProviderPubkey) {
      log.warn(`Ignoring result from non-selected Provider ${event.pubkey}`);
      return;
    }

    try {
      const payload = parseOracleQueryResponseEvent(
        event,
        config.identity.secretKey,
        event.pubkey,
      );
      if (payload === null) {
        log.warn(`Result for ${queryId} carries no readable oracle_payload`);
        return;
      }
      if (
        payload.query_id !== entry.query.id ||
        payload.request_event_id !== entry.queryEventId
      ) {
        log.warn(`Result payload binding mismatch for ${queryId}`);
        return;
      }

      const result = oracleResponseToResult(entry.query, payload);
      const outcome = await dispatchVerifyAndDeliver(
        queryId,
        entry.query,
        result,
        event.pubkey,
      );
      if (outcome.terminal) unwatchRequest(queryId);
      config.onVerification?.(queryId, outcome.passed, event.pubkey);
    } catch (error) {
      log.error(`Failed to process result for ${queryId}:`, error);
    }
  }

  async function rejectQuorumWithoutFrost(
    queryId: string,
    providerPubkey: string,
  ): Promise<DeliveryOutcome> {
    const reason =
      "Quorum verification requested but FROST is not configured on this Oracle";
    const dm = buildRejectionDM(
      config.identity,
      providerPubkey,
      queryId,
      reason,
    );
    await relayClient.publish(dm);
    log.error(`Rejection sent to Provider for ${queryId}: ${reason}`);
    return { passed: false, terminal: true };
  }

  async function verifyAndDeliverInternal(
    queryId: string,
    query: VerifiableRequest,
    result: RequestSubmissionResult,
    providerPubkey: string,
  ): Promise<DeliveryOutcome> {
    const detail = await verifyFn(query, result);
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
        const publishResult = await relayClient.publish(dm);
        if (publishResult.successes.length > 0) {
          log.info(
            `Preimage delivered to Provider for ${queryId} (${publishResult.successes.length} relay(s))`,
          );
          delivered = true;
          break;
        }
        const delayMs = retryDelaysMs[attempt - 1];
        if (delayMs !== undefined) {
          log.warn(
            `Preimage delivery failed for ${queryId} (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      if (!delivered) {
        log.error(
          `Preimage delivery failed for ${queryId} after ${maxAttempts} attempts — preimage retained for Nostr retry`,
        );
        return { passed: false, terminal: false };
      }
      preimageStore.delete(hash);
      queryHashMap.delete(queryId);
      return { passed: true, terminal: true };
    } else {
      const reason = detail.failures.join(", ") || "Verification failed";
      const dm = buildRejectionDM(
        config.identity,
        providerPubkey,
        queryId,
        reason,
      );
      await relayClient.publish(dm);
      log.info(`Rejection sent to Provider for ${queryId}: ${reason}`);
      return { passed: false, terminal: true };
    }
  }

  async function verifyAndDeliverWithFrostInternal(
    queryId: string,
    query: VerifiableRequest,
    result: RequestSubmissionResult,
    providerPubkey: string,
    frostNodeConfig: FrostNodeConfig,
  ): Promise<DeliveryOutcome> {
    const detail = await verifyFn(query, result);
    if (!detail.passed) {
      const reason = detail.failures.join(", ") || "Verification failed";
      const dm = buildRejectionDM(
        config.identity,
        providerPubkey,
        queryId,
        reason,
      );
      await relayClient.publish(dm);
      log.info(`Rejection sent to Provider for ${queryId}: ${reason}`);
      return { passed: false, terminal: true };
    }

    // Coordinate FROST signing with peer Oracle nodes. Each peer's
    // /frost/signer/round1 endpoint independently verifies before signing;
    // peers that fail verification refuse to participate → below threshold
    // = no signature.
    const escrowToken = query.escrow?.type === "p2pk_frost"
      ? query.escrow.escrow_token
      : undefined;
    const messages = escrowToken
      ? deriveFrostP2pkMessages(escrowToken)
      : [deriveFrostSigningMessage(queryId)];
    const groupSignatures: string[] = [];
    const signers = new Set<number>();
    for (const messageHex of messages) {
      const sigResult = await coordinateSigning(
        {
          nodeConfig: frostNodeConfig,
          requirement: requestToRequirement(query),
          input: resultToVerificationInput(result),
          escrowToken,
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
        await relayClient.publish(dm);
        return { passed: false, terminal: true };
      }
      groupSignatures.push(sigResult.signature);
      for (const signer of sigResult.signers_participated) signers.add(signer);
    }

    const dm = buildFrostSignatureDM(
      config.identity,
      providerPubkey,
      queryId,
      groupSignatures,
      frostNodeConfig.group_pubkey,
    );
    const publishResult = await relayClient.publish(dm);
    if (publishResult.successes.length > 0) {
      log.info(
        `FROST signature delivered to Provider for ${queryId} (signers: ${
          [...signers].join(",")
        })`,
      );
      return { passed: true, terminal: true };
    }
    log.error(`FROST signature delivery failed for ${queryId}`);
    return { passed: false, terminal: false };
  }

  async function dispatchVerifyAndDeliver(
    queryId: string,
    query: VerifiableRequest,
    result: RequestSubmissionResult,
    providerPubkey: string,
  ): Promise<DeliveryOutcome> {
    if (query.quorum) {
      // A quorum query demands threshold verification. Never downgrade to
      // the single-oracle preimage path when FROST is not configured —
      // reject loudly so the customer's trust model is honoured.
      if (
        !config.frostCoordinator || !config.frostConfig ||
        !config.frostNodeConfig
      ) {
        return rejectQuorumWithoutFrost(queryId, providerPubkey);
      }
      return verifyAndDeliverWithFrostInternal(
        queryId,
        query,
        result,
        providerPubkey,
        config.frostNodeConfig,
      );
    }
    return verifyAndDeliverInternal(queryId, query, result, providerPubkey);
  }

  function unwatchRequest(queryId: string): void {
    const entry = watched.get(queryId);
    if (!entry) return;
    for (const sub of entry.subs) sub.close();
    watched.delete(queryId);
  }

  return {
    generateRequestHash(queryId: string) {
      return { hash: issueHash(queryId) };
    },

    watchRequest(
      request: VerifiableRequest,
      queryEventId: string,
      customerPubkey: string,
    ) {
      const queryId = request.id;
      const entry: WatchedQuery = {
        query: request,
        queryEventId,
        customerPubkey,
        offeredProviders: new Set(),
        subs: [],
      };

      const feedbackSub = relayClient.subscribe(
        { kinds: [7000], "#e": [queryEventId] },
        (event) =>
          handleFeedbackEvent(
            config.identity,
            watched,
            queryId,
            event,
            config.onOffer,
          ),
      );
      entry.subs.push(feedbackSub);

      const responseSub = relayClient.subscribe(
        { kinds: [6300], "#e": [queryEventId] },
        (event) => handleResponseEvent(queryId, event),
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
      const outcome = await dispatchVerifyAndDeliver(
        queryId,
        query,
        result,
        providerPubkey,
      );
      if (outcome.terminal) unwatchRequest(queryId);
      return outcome.passed;
    },

    async verifyAndDeliverWithFrost(queryId, query, result, providerPubkey) {
      const outcome = config.frostNodeConfig === undefined
        ? await rejectQuorumWithoutFrost(queryId, providerPubkey)
        : await verifyAndDeliverWithFrostInternal(
          queryId,
          query,
          result,
          providerPubkey,
          config.frostNodeConfig,
        );
      if (outcome.terminal) unwatchRequest(queryId);
      return outcome.passed;
    },

    stop() {
      hashResponder.close();
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
  const relayUrls = (Deno.env.get("NOSTR_RELAYS") ?? "").split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (relayUrls.length === 0) return null;

  return createOracleNostrService({
    identity,
    relayClient: createRelayClient(relayUrls),
  });
}
