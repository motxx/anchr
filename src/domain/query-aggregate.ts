import type {
  HtlcInfo,
  PaymentStatus,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  QuoteInfo,
  SubmissionMeta,
  VerificationDetail,
  VerificationFactor,
  BlossomKeyMap,
  BountyInfo,
  GpsCoord,
  QuorumConfig,
  OracleAttestationRecord,
  RequesterMeta,
} from "./types";
import { DEFAULT_VERIFICATION_FACTORS } from "./types";
import { randomBytes } from "node:crypto";
import { isValidTransition, isCancellable, isExpirable } from "./query-transitions";
import { validateQueryInput, validateHtlcLocktime, validateQuoteInfo } from "./value-objects";
import { buildChallengeRule, generateNonce } from "./challenge";

export type TransitionResult =
  | { ok: true; query: Query }
  | { ok: false; error: string };

export interface CreateQueryAggregateOptions {
  ttlMs: number;
  requesterMeta?: RequesterMeta;
  bounty?: BountyInfo;
  oracleIds?: string[];
  htlc?: HtlcInfo;
  nostrEventId?: string;
  quorum?: QuorumConfig;
}

/** Minimum HTLC locktime in seconds (10 minutes). */
export const MIN_HTLC_LOCKTIME_SECS = 600;

function generateQueryId(): string {
  return `query_${Date.now()}_${randomBytes(8).toString("hex")}`;
}

/** Factory: create a new Query from input + options. Pure function except for ID + nonce generation. */
export function createQueryAggregate(
  input: QueryInput,
  options: CreateQueryAggregateOptions,
): TransitionResult {
  const inputError = validateQueryInput(input);
  if (inputError) return { ok: false, error: inputError };

  const now = Date.now();

  if (options.htlc?.locktime) {
    const nowSecs = Math.floor(now / 1000);
    const locktimeError = validateHtlcLocktime(options.htlc.locktime, nowSecs, MIN_HTLC_LOCKTIME_SECS);
    if (locktimeError) return { ok: false, error: locktimeError };
  }

  const requirements = input.verification_requirements ?? DEFAULT_VERIFICATION_FACTORS;
  const needsNonce = requirements.includes("nonce");
  const nonce = needsNonce ? generateNonce() : undefined;
  const isHtlc = options.htlc !== undefined;

  const query: Query = {
    id: generateQueryId(),
    status: isHtlc ? "awaiting_quotes" : "pending",
    description: input.description,
    location_hint: input.location_hint,
    challenge_nonce: nonce,
    challenge_rule: nonce ? buildChallengeRule(nonce, input.description) : undefined,
    verification_requirements: requirements,
    created_at: now,
    expires_at: now + options.ttlMs,
    requester_meta: options.requesterMeta,
    bounty: options.bounty,
    oracle_ids: options.oracleIds,
    payment_status: isHtlc ? "htlc_locked" : "locked",
    htlc: options.htlc,
    quotes: isHtlc ? [] : undefined,
    nostr_event_id: options.nostrEventId,
    expected_gps: input.expected_gps,
    max_gps_distance_km: input.max_gps_distance_km,
    tlsn_requirements: input.tlsn_requirements,
    quorum: options.quorum,
    visibility: input.visibility,
  };

  return { ok: true, query };
}

/** Simple path: submit result and transition pending → approved/rejected. */
export function submitResult(
  query: Query,
  result: QueryResult,
  verification: VerificationDetail,
  meta: SubmissionMeta,
  oracleId?: string,
  attestations?: OracleAttestationRecord[],
  blossomKeys?: BlossomKeyMap,
): TransitionResult {
  if (query.htlc !== undefined) {
    return { ok: false, error: "Use HTLC-specific functions for HTLC queries" };
  }
  if (query.status !== "pending") {
    return { ok: false, error: `Query is ${query.status}, not pending` };
  }
  if (query.expires_at < Date.now()) {
    return {
      ok: true,
      query: { ...query, status: "expired", payment_status: "cancelled" },
    };
  }

  const newStatus: QueryStatus = verification.passed ? "approved" : "rejected";
  const paymentStatus: PaymentStatus = verification.passed ? "released" : "cancelled";
  const firstOracle = attestations?.[0]?.oracle_id ?? oracleId;

  return {
    ok: true,
    query: {
      ...query,
      status: newStatus,
      submitted_at: Date.now(),
      result,
      verification,
      submission_meta: meta,
      payment_status: paymentStatus,
      assigned_oracle_id: firstOracle,
      blossom_keys: blossomKeys,
      attestations: query.quorum ? attestations : undefined,
    },
  };
}

/** Expire a query if it is expirable and past its deadline. */
export function expireQuery(query: Query, now: number): TransitionResult {
  if (!isExpirable(query.status)) {
    return { ok: false, error: `Query is ${query.status}, cannot expire` };
  }
  if (query.expires_at >= now) {
    return { ok: false, error: "Query has not expired yet" };
  }
  return {
    ok: true,
    query: { ...query, status: "expired", payment_status: "cancelled" },
  };
}

/** Cancel a query if it is in a cancellable state. */
export function cancelQuery(query: Query): TransitionResult {
  if (!isCancellable(query.status)) {
    return { ok: false, error: `Query is already ${query.status}` };
  }
  return {
    ok: true,
    query: { ...query, status: "rejected", payment_status: "cancelled" },
  };
}

// --- HTLC path ---

/** Record a worker quote for an HTLC query. */
export function addQuote(query: Query, quote: QuoteInfo): TransitionResult {
  if (query.htlc === undefined) {
    return { ok: false, error: "Not an HTLC query" };
  }
  if (query.status !== "awaiting_quotes") {
    return { ok: false, error: `Query is ${query.status}, not awaiting_quotes` };
  }
  const quoteError = validateQuoteInfo(quote);
  if (quoteError) return { ok: false, error: quoteError };

  const quotes = [...(query.quotes ?? []), quote];
  return { ok: true, query: { ...query, quotes } };
}

/** Select a worker and transition awaiting_quotes → worker_selected. */
export function selectWorker(
  query: Query,
  workerPubkey: string,
  htlcUpdates: Partial<HtlcInfo>,
): TransitionResult {
  if (query.htlc === undefined) {
    return { ok: false, error: "Not an HTLC query" };
  }
  if (!isValidTransition(query.status, "worker_selected", true)) {
    return { ok: false, error: `Query is ${query.status}, not awaiting_quotes` };
  }

  const htlc: HtlcInfo = {
    ...query.htlc,
    worker_pubkey: workerPubkey,
    ...htlcUpdates,
  };

  return {
    ok: true,
    query: {
      ...query,
      status: "worker_selected",
      htlc,
      payment_status: htlcUpdates.escrow_token ? "htlc_swapped" : query.payment_status,
    },
  };
}

/** Worker acknowledges selection and begins work (worker_selected → processing). */
export function beginWork(query: Query): TransitionResult {
  if (query.htlc === undefined) {
    return { ok: false, error: "Not an HTLC query" };
  }
  if (!isValidTransition(query.status, "processing", true)) {
    return { ok: false, error: `Query is ${query.status}, not worker_selected` };
  }
  return {
    ok: true,
    query: { ...query, status: "processing" },
  };
}

/** Record a worker's result submission (processing → verifying). */
export function recordResult(
  query: Query,
  result: QueryResult,
  workerPubkey: string,
  blossomKeys?: BlossomKeyMap,
): TransitionResult {
  if (query.htlc === undefined) {
    return { ok: false, error: "Not an HTLC query" };
  }
  if (!isValidTransition(query.status, "verifying", true)) {
    return { ok: false, error: `Query is ${query.status}, not processing` };
  }
  if (query.htlc.worker_pubkey && query.htlc.worker_pubkey !== workerPubkey) {
    return { ok: false, error: "Worker pubkey does not match selected worker" };
  }

  return {
    ok: true,
    query: {
      ...query,
      status: "verifying",
      result,
      submitted_at: Date.now(),
      submission_meta: { executor_type: "human", channel: "worker_api" },
      blossom_keys: blossomKeys,
    },
  };
}

/** Complete oracle verification (verifying → approved/rejected). */
export function completeVerification(
  query: Query,
  passed: boolean,
  verification?: VerificationDetail,
  oracleId?: string,
  attestations?: OracleAttestationRecord[],
): TransitionResult {
  if (query.htlc === undefined) {
    return { ok: false, error: "Not an HTLC query" };
  }
  const target: QueryStatus = passed ? "approved" : "rejected";
  if (!isValidTransition(query.status, target, true)) {
    return { ok: false, error: `Query is ${query.status}, not verifying` };
  }

  const paymentStatus: PaymentStatus = passed ? "released" : "cancelled";
  return {
    ok: true,
    query: {
      ...query,
      status: target,
      payment_status: paymentStatus,
      verification: verification ?? query.verification,
      assigned_oracle_id: oracleId ?? attestations?.[0]?.oracle_id,
      attestations: query.quorum ? attestations : undefined,
    },
  };
}
