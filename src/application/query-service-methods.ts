import { randomBytes } from "node:crypto";
import type { QueryStore } from "../domain/query-store";
import { normalizeQueryResult } from "../infrastructure/attachments";
import { buildChallengeRule, generateNonce } from "../domain/challenge";
import type { PreimageStore } from "../infrastructure/preimage/preimage-store";
import type { EscrowProvider } from "./escrow-port";
import { verifyWithQuorum } from "./query-verification";
import type { OracleResolver, MultiOracleResolver } from "./query-verification";
import {
  isHtlcQuery,
  MIN_HTLC_LOCKTIME_SECS,
  validateHtlcTransition,
  verifyEscrowAmount,
  verifyEscrowLock,
} from "./query-htlc-validation";
import type {
  BlossomKeyMap,
  HtlcInfo,
  HtlcSubmitOutcome,
  OracleAttestationRecord,
  PaymentStatus,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  SubmissionMeta,
  QuoteInfo,
} from "../domain/types";
import { DEFAULT_VERIFICATION_FACTORS } from "../domain/types";
import type { ProofDelivery } from "./proof-delivery";
import { isCancellable, isExpirable } from "../domain/query-transitions";
import type {
  CancelQueryOutcome,
  CreateQueryOptions,
  HtlcOutcome,
  QueryHooks,
  SubmitQueryOutcome,
} from "./query-service";

export interface ServiceDeps {
  store: QueryStore;
  oracleResolver: OracleResolver;
  multiOracleResolver?: MultiOracleResolver;
  preimageStore?: PreimageStore;
  escrowProvider?: EscrowProvider;
  proofDelivery?: ProofDelivery;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function resolveTtlMs(options?: CreateQueryOptions): number {
  if (!options) return DEFAULT_TTL_MS;
  if (typeof options.ttlMs === "number") return options.ttlMs;
  if (typeof options.ttlSeconds === "number") return options.ttlSeconds * 1000;
  return DEFAULT_TTL_MS;
}

function generateQueryId(): string {
  return `query_${Date.now()}_${randomBytes(8).toString("hex")}`;
}

/**
 * Publish attestations to Nostr relays in parallel (best-effort).
 * Awaited so published_proofs IDs can be stored, but failures
 * do not affect the verification outcome.
 */
async function publishAttestations(
  query: Query,
  attestations: OracleAttestationRecord[],
  proofDelivery: ProofDelivery,
): Promise<string[]> {
  if (query.visibility !== "public") return [];

  const results = await Promise.allSettled(
    attestations.map((att) => proofDelivery.publish(query, att, "public")),
  );

  const eventIds: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      eventIds.push(r.value.event_id);
    } else if (r.status === "rejected") {
      console.error(`[proof-publish] Attestation publish failed:`, r.reason);
    }
  }
  return eventIds;
}

/** Shared: run oracle verification and build the finalized query record. */
async function verifyAndFinalize(
  query: Query,
  normalizedResult: QueryResult,
  deps: ServiceDeps,
  blossomKeys: BlossomKeyMap | undefined,
  oracleId: string | undefined,
) {
  const { passed, attestations, verification } = await verifyWithQuorum(
    query, normalizedResult, deps.oracleResolver, deps.multiOracleResolver, blossomKeys, oracleId,
  );
  const newStatus: QueryStatus = passed ? "approved" : "rejected";
  const paymentStatus: PaymentStatus = passed ? "released" : "cancelled";

  // Publish attestations for public visibility queries (best-effort)
  let publishedProofs: string[] | undefined;
  if (deps.proofDelivery && query.visibility === "public" && attestations.length > 0) {
    publishedProofs = await publishAttestations(query, attestations, deps.proofDelivery)
      .catch((err) => {
        console.error(`[proof-publish] Failed to publish attestations:`, err);
        return undefined;
      });
  }

  const updated: Query = {
    ...query,
    status: newStatus,
    payment_status: paymentStatus,
    verification,
    assigned_oracle_id: attestations[0]?.oracle_id,
    attestations: query.quorum ? attestations : undefined,
    published_proofs: publishedProofs?.length ? publishedProofs : undefined,
  };
  return { passed, attestations, verification, updated };
}

/** Shared: attempt to reveal a preimage for an approved HTLC query. */
function tryRevealPreimage(
  preimageStore: PreimageStore | undefined,
  htlcHash: string | undefined,
  passed: boolean,
): string | undefined {
  if (!passed || !preimageStore || !htlcHash) return undefined;
  const preimage = preimageStore.getPreimage(htlcHash);
  if (preimage) { preimageStore.delete(htlcHash); return preimage; }
  return undefined;
}

export function doCreateQuery(
  deps: ServiceDeps,
  input: QueryInput,
  options: CreateQueryOptions | undefined,
  hooks: QueryHooks | undefined,
): Query {
  const now = Date.now();

  // CTF-3: Enforce minimum HTLC locktime to prevent immediate-refund race attacks.
  if (options?.htlc?.locktime) {
    const nowSecs = Math.floor(now / 1000);
    if (options.htlc.locktime - nowSecs < MIN_HTLC_LOCKTIME_SECS) {
      throw new Error(
        `HTLC locktime must be at least ${MIN_HTLC_LOCKTIME_SECS}s in the future (got ${options.htlc.locktime - nowSecs}s)`,
      );
    }
  }

  const requirements = input.verification_requirements
    ?? DEFAULT_VERIFICATION_FACTORS;
  const needsNonce = requirements.includes("nonce");
  const nonce = needsNonce ? generateNonce() : undefined;
  const isHtlc = options?.htlc !== undefined;
  const query: Query = {
    id: generateQueryId(),
    status: isHtlc ? "awaiting_quotes" : "pending",
    description: input.description,
    location_hint: input.location_hint,
    challenge_nonce: nonce,
    challenge_rule: nonce ? buildChallengeRule(nonce, input.description) : undefined,
    verification_requirements: requirements,
    created_at: now,
    expires_at: now + resolveTtlMs(options),
    requester_meta: options?.requesterMeta,
    bounty: options?.bounty,
    oracle_ids: options?.oracleIds,
    payment_status: isHtlc ? "htlc_locked" : "locked",
    htlc: options?.htlc,
    quotes: isHtlc ? [] : undefined,
    nostr_event_id: options?.nostrEventId,
    expected_gps: input.expected_gps,
    max_gps_distance_km: input.max_gps_distance_km,
    tlsn_requirements: input.tlsn_requirements,
    quorum: options?.quorum,
    visibility: input.visibility,
  };

  deps.store.set(query.id, query);
  hooks?.onCreated?.(query);
  return query;
}

export async function doSubmitQueryResult(
  deps: ServiceDeps,
  id: string,
  result: QueryResult,
  submissionMeta: SubmissionMeta,
  oracleId?: string,
  blossomKeys?: BlossomKeyMap,
): Promise<SubmitQueryOutcome> {
  const { store } = deps;
  const query = store.get(id);
  if (!query) return { ok: false, query: null, message: "Query not found" };
  if (query.status !== "pending") return { ok: false, query, message: `Query is ${query.status}, not pending` };
  if (query.expires_at < Date.now()) {
    store.set(id, { ...query, status: "expired", payment_status: "cancelled" });
    return { ok: false, query, message: "Query has expired" };
  }

  const normalizedResult = normalizeQueryResult(result);
  const { passed, attestations, verification, updated } = await verifyAndFinalize(
    query, normalizedResult, deps, blossomKeys, oracleId,
  );

  if (!passed && attestations.length === 0) {
    return { ok: false, query, message: verification.failures[0] ?? "No oracle available" };
  }

  const final: Query = { ...updated, submitted_at: Date.now(), result: normalizedResult, submission_meta: submissionMeta, blossom_keys: blossomKeys };
  store.set(id, final);

  return {
    ok: passed,
    query: final,
    message: passed ? "Verification passed. Result accepted." : `Verification failed: ${verification.failures.join(", ")}`,
  };
}

export function doCancelQuery(store: QueryStore, id: string): CancelQueryOutcome {
  const query = store.get(id);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isCancellable(query.status)) return { ok: false, message: `Query is already ${query.status}` };
  store.set(id, { ...query, status: "rejected", payment_status: "cancelled" });
  return { ok: true, message: "Query cancelled" };
}

export function doExpireQueries(store: QueryStore): number {
  const now = Date.now();
  let count = 0;
  for (const query of store.values()) {
    if (isExpirable(query.status) && query.expires_at < now) {
      store.set(query.id, { ...query, status: "expired", payment_status: "cancelled" });
      count++;
    }
  }
  return count;
}

export function doPurgeExpired(store: QueryStore): Query[] {
  const expired: Query[] = [];
  for (const query of store.values()) {
    if (query.status === "expired") {
      expired.push(query);
      store.delete(query.id);
    }
  }
  return expired;
}

export function doRecordQuote(
  store: QueryStore,
  queryId: string,
  quote: QuoteInfo,
): HtlcOutcome {
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isHtlcQuery(query)) return { ok: false, message: "Not an HTLC query" };
  if (query.status !== "awaiting_quotes") return { ok: false, message: `Query is ${query.status}, not awaiting_quotes` };

  const quotes = [...(query.quotes ?? []), quote];
  store.set(queryId, { ...query, quotes });
  return { ok: true, message: "Quote recorded" };
}

export async function doSelectWorker(
  deps: ServiceDeps,
  queryId: string,
  workerPubkey: string,
  htlcToken?: string,
): Promise<HtlcOutcome> {
  const { store } = deps;
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isHtlcQuery(query)) return { ok: false, message: "Not an HTLC query" };
  if (!validateHtlcTransition(query.status, "processing")) return { ok: false, message: `Query is ${query.status}, not awaiting_quotes` };

  // Verify escrow amount matches bounty
  const escrowRef = query.escrow?.escrow_ref ?? query.htlc?.escrow_token ?? htlcToken;
  const expectedSats = query.bounty?.amount_sats;
  let verifiedEscrowSats: number | undefined;
  if (escrowRef && expectedSats && deps.escrowProvider) {
    const check = await verifyEscrowAmount(deps.escrowProvider, escrowRef, expectedSats);
    if (!check.valid) {
      return { ok: false, message: `Escrow token verification failed: ${check.error}` };
    }
    verifiedEscrowSats = check.amountSats;
  }

  // CTF-2: Verify escrow lock conditions (hashlock + P2PK).
  const paymentHash = query.escrow?.hash ?? query.htlc?.hash;
  if (escrowRef && paymentHash && deps.escrowProvider) {
    const lockCheck = await verifyEscrowLock(deps.escrowProvider, escrowRef, paymentHash, workerPubkey);
    if (!lockCheck.ok) {
      return { ok: false, message: lockCheck.message! };
    }
  }

  const htlc: HtlcInfo = {
    ...query.htlc!,
    worker_pubkey: workerPubkey,
    escrow_token: htlcToken ?? query.htlc?.escrow_token,
    verified_escrow_sats: verifiedEscrowSats,
  };

  store.set(queryId, {
    ...query,
    status: "processing",
    htlc,
    payment_status: htlcToken ? "htlc_swapped" : query.payment_status,
  });
  return { ok: true, message: "Worker selected" };
}

export function doRecordResult(
  store: QueryStore,
  queryId: string,
  result: QueryResult,
  workerPubkey: string,
  blossomKeys?: BlossomKeyMap,
): HtlcOutcome {
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isHtlcQuery(query)) return { ok: false, message: "Not an HTLC query" };
  if (!validateHtlcTransition(query.status, "verifying")) return { ok: false, message: `Query is ${query.status}, not processing` };
  if (query.htlc?.worker_pubkey && query.htlc.worker_pubkey !== workerPubkey) {
    return { ok: false, message: "Worker pubkey does not match selected worker" };
  }

  const normalizedResult = normalizeQueryResult(result);
  store.set(queryId, {
    ...query,
    status: "verifying",
    result: normalizedResult,
    submitted_at: Date.now(),
    submission_meta: { executor_type: "human", channel: "worker_api" },
    blossom_keys: blossomKeys,
  });
  return { ok: true, message: "Result recorded, verification in progress" };
}

export function doCompleteVerification(
  store: QueryStore,
  queryId: string,
  passed: boolean,
  oracleId?: string,
): HtlcOutcome {
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isHtlcQuery(query)) return { ok: false, message: "Not an HTLC query" };
  const verifyTarget: QueryStatus = passed ? "approved" : "rejected";
  if (!validateHtlcTransition(query.status, verifyTarget)) return { ok: false, message: `Query is ${query.status}, not verifying` };

  const newStatus: QueryStatus = verifyTarget;
  const paymentStatus: PaymentStatus = passed ? "released" : "cancelled";
  store.set(queryId, {
    ...query,
    status: newStatus,
    payment_status: paymentStatus,
    assigned_oracle_id: oracleId,
  });
  return { ok: true, message: passed ? "Verification passed" : "Verification failed" };
}

export async function doSubmitHtlcResult(
  deps: ServiceDeps,
  queryId: string,
  result: QueryResult,
  workerPubkey: string,
  oracleId?: string,
  blossomKeys?: BlossomKeyMap,
): Promise<HtlcSubmitOutcome> {
  const { store } = deps;
  const query = store.get(queryId);
  if (!query) return { ok: false, query: null, message: "Query not found" };
  if (!isHtlcQuery(query)) return { ok: false, query, message: "Not an HTLC query" };
  if (!validateHtlcTransition(query.status, "verifying")) return { ok: false, query, message: `Query is ${query.status}, not processing` };
  if (query.htlc?.worker_pubkey && query.htlc.worker_pubkey !== workerPubkey) {
    return { ok: false, query, message: "Worker pubkey does not match selected worker" };
  }

  // 1. Record result (processing -> verifying)
  const normalizedResult = normalizeQueryResult(result);
  const verifyingQuery: Query = {
    ...query,
    status: "verifying",
    result: normalizedResult,
    submitted_at: Date.now(),
    submission_meta: { executor_type: "human", channel: "worker_api" },
    blossom_keys: blossomKeys,
  };
  store.set(queryId, verifyingQuery);

  // 2. Verify with oracle(s) and finalize
  const { passed, verification, updated } = await verifyAndFinalize(
    verifyingQuery, normalizedResult, deps, blossomKeys, oracleId,
  );
  store.set(queryId, updated);

  // 3. Reveal preimage on success (HTLC settlement = preimage disclosure)
  const preimage = tryRevealPreimage(deps.preimageStore, query.htlc?.hash, passed);
  if (preimage) {
    return { ok: true, query: updated, message: "Verification passed. Preimage revealed for HTLC redemption.", preimage };
  }

  return {
    ok: passed, query: updated,
    message: passed ? "Verification passed." : `Verification failed: ${verification.failures.join(", ")}`,
  };
}
