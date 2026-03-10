/**
 * Nostr-native query service (NIP-90 DVM compatible).
 *
 * Replaces SQLite as source of truth. Queries live on Nostr relays;
 * local state is an ephemeral in-memory cache for active sessions.
 *
 * Event kinds follow the NIP-90 Data Vending Machine spec:
 *
 * Flow:
 *   1. Requester publishes DVM Job Request (kind 5300) → relay
 *   2. Worker subscribes, sees query, does work
 *   3. Worker publishes DVM Job Result (kind 6300, NIP-44 encrypted) → relay
 *   4. Requester receives response, runs oracle verification
 *   5. Oracle publishes OracleAttestation (kind 30103, plaintext) → relay
 *   6. Requester publishes DVM Job Feedback (kind 7000, NIP-44 encrypted + Cashu) → relay
 *   7. Worker receives settlement, redeems Cashu token
 */

import type { Event } from "nostr-tools/core";
import type { SubCloser } from "nostr-tools/pool";
import { executeEscrowSwap, calculateOracleFee } from "../cashu/escrow";
import { isCashuEnabled, verifyToken } from "../cashu/wallet";
import { generateNonce, buildChallengeRule } from "../challenge";
import { resolveOracle } from "../oracle/registry";
import type { OracleAttestation } from "../oracle/types";
import type {
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  RequesterMeta,
  BountyInfo,
  SubmissionMeta,
  VerificationDetail,
} from "../types";
import {
  publishEvent,
  subscribeToResponses,
  subscribeToAttestations,
  fetchRecentQueries,
} from "./client";
import { generateEphemeralIdentity, type NostrIdentity } from "./identity";
import {
  buildQueryRequestEvent,
  buildQuerySettlementEvent,
  parseQueryRequestPayload,
  parseQueryResponsePayload,
  type QueryRequestPayload,
  type QueryResponsePayload,
  type QuerySettlementPayload,
} from "./events";
import {
  buildOracleAttestationEvent,
  parseOracleAttestationPayload,
} from "./oracle-attestation";

// --- In-memory state for active queries ---

interface ActiveQuery {
  identity: NostrIdentity;
  nostrEventId: string;
  queryId: string;
  input: QueryInput;
  nonce: string;
  expiresAt: number;
  oracleIds?: string[];
  requesterMeta?: RequesterMeta;
  bounty?: BountyInfo;
  status: QueryStatus;
  response?: QueryResponsePayload;
  workerPubKey?: string;
  responseEventId?: string;
  attestation?: OracleAttestation;
  verification?: VerificationDetail;
  result?: QueryResult;
  responseSub?: SubCloser;
  attestationSub?: SubCloser;
}

const activeQueries = new Map<string, ActiveQuery>();

// --- Helpers ---

function activeToQuery(aq: ActiveQuery): Query {
  return {
    id: aq.queryId,
    type: aq.input.type,
    status: aq.status,
    params: aq.input,
    challenge_nonce: aq.nonce,
    challenge_rule: buildChallengeRule(aq.input.type, aq.nonce, aq.input as unknown as Record<string, unknown>),
    created_at: Date.now(),
    expires_at: aq.expiresAt,
    requester_meta: aq.requesterMeta,
    bounty: aq.bounty,
    oracle_ids: aq.oracleIds,
    assigned_oracle_id: aq.attestation?.oracle_id,
    result: aq.result,
    verification: aq.verification,
    payment_status: aq.status === "approved" ? "released" : aq.status === "rejected" ? "cancelled" : "locked",
  };
}

function responseToQueryResult(
  queryType: string,
  response: QueryResponsePayload,
): QueryResult {
  switch (queryType) {
    case "photo_proof":
      return {
        type: "photo_proof",
        text_answer: response.text_answer,
        attachments: (response.attachments ?? []).map((att, i) => ({
          id: att.blossom_hash,
          uri: att.blossom_urls[0] ?? "",
          mime_type: att.mime,
          storage_kind: "blossom" as const,
          blossom_hash: att.blossom_hash,
          blossom_encrypt_key: att.decrypt_key,
          blossom_servers: att.blossom_urls,
        })),
      };
    case "store_status":
      return {
        type: "store_status",
        status: (response.status as "open" | "closed") ?? "open",
        text_answer: response.text_answer,
        attachments: (response.attachments ?? []).map((att) => ({
          id: att.blossom_hash,
          uri: att.blossom_urls[0] ?? "",
          mime_type: att.mime,
          storage_kind: "blossom" as const,
          blossom_hash: att.blossom_hash,
          blossom_encrypt_key: att.decrypt_key,
          blossom_servers: att.blossom_urls,
        })),
      };
    case "webpage_field":
      return {
        type: "webpage_field",
        answer: response.answer ?? response.text_answer ?? "",
        proof_text: response.proof_text ?? "",
      };
    default:
      throw new Error(`Unknown query type: ${queryType}`);
  }
}

// --- Public API ---

export interface NostrCreateQueryOptions {
  ttlMs?: number;
  requesterMeta?: RequesterMeta;
  bounty?: BountyInfo;
  oracleIds?: string[];
  regionCode?: string;
  relayUrls?: string[];
}

/**
 * Create and publish a query to Nostr relays.
 * Returns the query and starts listening for responses.
 */
export async function createNostrQuery(
  input: QueryInput,
  options?: NostrCreateQueryOptions,
): Promise<Query | null> {
  const identity = generateEphemeralIdentity();
  const nonce = generateNonce();
  const queryId = `gt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ttlMs = options?.ttlMs ?? 600_000;
  const expiresAt = Date.now() + ttlMs;

  const payload: QueryRequestPayload = {
    type: input.type,
    params: input as unknown as Record<string, unknown>,
    nonce,
    expires_at: expiresAt,
  };

  if (options?.oracleIds?.length) {
    payload.oracle_ids = options.oracleIds;
  }

  if (options?.bounty?.cashu_token) {
    payload.bounty = {
      mint: process.env.CASHU_MINT_URL ?? "",
      token: options.bounty.cashu_token,
    };
  }

  const event = buildQueryRequestEvent(identity, queryId, payload, options?.regionCode);
  const result = await publishEvent(event, options?.relayUrls);

  if (result.successes.length === 0) {
    console.error("[nostr-qs] Failed to publish query:", result.failures);
    return null;
  }

  const aq: ActiveQuery = {
    identity,
    nostrEventId: event.id,
    queryId,
    input,
    nonce,
    expiresAt,
    oracleIds: options?.oracleIds,
    requesterMeta: options?.requesterMeta,
    bounty: options?.bounty,
    status: "pending",
  };

  // Auto-subscribe to responses
  aq.responseSub = subscribeToResponses(event.id, (responseEvent: Event) => {
    handleResponse(aq, responseEvent);
  }, options?.relayUrls);

  activeQueries.set(queryId, aq);

  console.error(`[nostr-qs] Published query ${queryId} to ${result.successes.length} relay(s)`);
  return activeToQuery(aq);
}

/**
 * Handle an incoming response event for an active query.
 */
function handleResponse(aq: ActiveQuery, responseEvent: Event): void {
  if (aq.status !== "pending") return;

  try {
    const response = parseQueryResponsePayload(
      responseEvent.content,
      aq.identity.secretKey,
      responseEvent.pubkey,
    );

    aq.response = response;
    aq.workerPubKey = responseEvent.pubkey;
    aq.responseEventId = responseEvent.id;
    aq.status = "submitted";

    console.error(`[nostr-qs] Received response for ${aq.queryId} from ${responseEvent.pubkey.slice(0, 8)}...`);
  } catch (err) {
    console.error("[nostr-qs] Failed to decrypt response:", err);
  }
}

/**
 * Get a query by ID from the active cache.
 */
export function getNostrQuery(queryId: string): Query | null {
  const aq = activeQueries.get(queryId);
  if (!aq) return null;

  // Check expiry
  if (aq.expiresAt < Date.now() && aq.status === "pending") {
    aq.status = "expired";
    aq.responseSub?.close();
    aq.attestationSub?.close();
  }

  return activeToQuery(aq);
}

/**
 * List queries from relays (both local cache and relay fetch).
 */
export async function listNostrQueries(options?: {
  regionCode?: string;
  relayUrls?: string[];
}): Promise<Query[]> {
  const events = await fetchRecentQueries({
    regionCode: options?.regionCode,
    relayUrls: options?.relayUrls,
  });

  return events
    .filter((e) => {
      const expTag = e.tags.find((t) => t[0] === "expiration");
      return !expTag || Number(expTag[1]) > Date.now() / 1000;
    })
    .map((e) => {
      const payload = parseQueryRequestPayload(e.content);
      const queryId = e.tags.find((t) => t[0] === "d")?.[1] ?? e.id;
      return {
        id: queryId,
        type: payload.type as Query["type"],
        status: "pending" as const,
        params: payload.params as unknown as QueryInput,
        challenge_nonce: payload.nonce,
        challenge_rule: "",
        created_at: e.created_at * 1000,
        expires_at: payload.expires_at,
        oracle_ids: payload.oracle_ids,
        payment_status: "locked" as const,
      };
    });
}

/**
 * Run oracle verification on a submitted response and publish attestation + settlement.
 *
 * This is the key function that replaces the central server's role:
 * 1. Resolve oracle (respects mutual selection)
 * 2. Run deterministic verification
 * 3. Publish OracleAttestation (kind 30103) to relays
 * 4. Execute Cashu P2PK escrow swap (if bounty exists)
 * 5. Publish DVM Job Feedback / Settlement (kind 7000) to relay (with Cashu token if passed)
 */
export async function verifyAndSettle(
  queryId: string,
  oracleId?: string,
  options?: { relayUrls?: string[] },
): Promise<{ ok: boolean; attestation: OracleAttestation | null; message: string }> {
  const aq = activeQueries.get(queryId);
  if (!aq) return { ok: false, attestation: null, message: "Query not found in active cache" };
  if (!aq.response || !aq.workerPubKey || !aq.responseEventId) {
    return { ok: false, attestation: null, message: "No response received yet" };
  }

  // Resolve oracle
  const oracle = resolveOracle(oracleId, aq.oracleIds);
  if (!oracle) {
    return { ok: false, attestation: null, message: "No acceptable oracle available" };
  }

  // Convert response to QueryResult for verification
  const queryResult = responseToQueryResult(aq.input.type, aq.response);
  const query = activeToQuery(aq);

  // Run oracle verification
  const attestation = await oracle.verify(query, queryResult);

  // Store verification result
  aq.attestation = attestation;
  aq.verification = {
    passed: attestation.passed,
    checks: attestation.checks,
    failures: attestation.failures,
  };
  aq.result = queryResult;
  aq.status = attestation.passed ? "approved" : "rejected";

  // Publish OracleAttestation (30103) to relays
  const oracleIdentity = generateEphemeralIdentity();
  const attestationEvent = buildOracleAttestationEvent(
    oracleIdentity,
    aq.nostrEventId,
    aq.responseEventId,
    attestation,
  );
  await publishEvent(attestationEvent, options?.relayUrls);

  // Execute Cashu P2PK escrow swap if bounty exists and verification passed
  let workerCashuToken: string | undefined;
  if (attestation.passed && aq.bounty?.cashu_token && isCashuEnabled()) {
    const tokenInfo = verifyToken(aq.bounty.cashu_token);
    if (tokenInfo.valid) {
      const feeSats = calculateOracleFee(tokenInfo.amountSats, oracle.info.fee_ppm);
      // In a full implementation, the escrow token's proofs would be
      // co-signed by oracle + worker, then swapped atomically.
      // For now, the worker receives the full bounty token and the
      // oracle fee is handled separately (fee_ppm=0 for built-in).
      if (feeSats === 0) {
        workerCashuToken = aq.bounty.cashu_token;
      } else {
        // Attempt atomic swap: worker gets (bounty - fee), oracle gets fee
        const { getDecodedToken } = await import("@cashu/cashu-ts");
        try {
          const decoded = getDecodedToken(aq.bounty.cashu_token);
          const swapResult = await executeEscrowSwap(
            decoded.proofs,
            aq.workerPubKey,
            oracleIdentity.publicKey,
            feeSats,
          );
          if (swapResult) {
            workerCashuToken = swapResult.workerToken;
            console.error(`[nostr-qs] Escrow swap: worker=${swapResult.workerAmountSats}sat, oracle=${swapResult.oracleFeeSats}sat`);
          } else {
            // Swap failed, fall back to giving full token to worker
            workerCashuToken = aq.bounty.cashu_token;
            console.error("[nostr-qs] Escrow swap failed, worker receives full bounty");
          }
        } catch (err) {
          workerCashuToken = aq.bounty.cashu_token;
          console.error("[nostr-qs] Escrow swap error, worker receives full bounty:", err);
        }
      }
    }
  }

  // Publish Settlement (7000) to relay
  const settlement: QuerySettlementPayload = attestation.passed
    ? { status: "accepted", cashu_token: workerCashuToken }
    : { status: "rejected", reason: attestation.failures.join(", ") };

  const settlementEvent = buildQuerySettlementEvent(
    aq.identity,
    aq.nostrEventId,
    aq.responseEventId,
    aq.workerPubKey,
    settlement,
  );
  await publishEvent(settlementEvent, options?.relayUrls);

  // Cleanup subscriptions
  aq.responseSub?.close();
  aq.attestationSub?.close();

  console.error(
    `[nostr-qs] ${attestation.passed ? "Approved" : "Rejected"} query ${queryId} via oracle ${oracle.info.id}`,
  );

  return { ok: attestation.passed, attestation, message: attestation.passed ? "Verified and settled" : `Verification failed: ${attestation.failures.join(", ")}` };
}

/**
 * Cancel an active query.
 */
export function cancelNostrQuery(queryId: string): { ok: boolean; message: string } {
  const aq = activeQueries.get(queryId);
  if (!aq) return { ok: false, message: "Query not found" };
  if (aq.status !== "pending") return { ok: false, message: `Query is ${aq.status}` };

  aq.status = "rejected";
  aq.responseSub?.close();
  aq.attestationSub?.close();
  activeQueries.delete(queryId);

  return { ok: true, message: "Query cancelled" };
}

/**
 * Clean up expired queries from memory.
 */
export function expireNostrQueries(): number {
  let count = 0;
  const now = Date.now();
  for (const [id, aq] of activeQueries) {
    if (aq.expiresAt < now && aq.status === "pending") {
      aq.status = "expired";
      aq.responseSub?.close();
      aq.attestationSub?.close();
      activeQueries.delete(id);
      count++;
    }
  }
  return count;
}

/**
 * Get count of active queries.
 */
export function activeQueryCount(): number {
  return activeQueries.size;
}
