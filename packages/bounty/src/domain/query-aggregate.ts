import type {
  BlossomKeyMap,
  BountyInfo,
  EscrowInfo,
  OracleAttestationRecord,
  PaymentStatus,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  QuorumConfig,
  QuoteInfo,
  RequesterMeta,
  SubmissionMeta,
  VerificationDetail,
} from "./types.ts";
import { DEFAULT_VERIFICATION_FACTORS } from "./types.ts";
import type { Clock, DomainServices } from "./ports.ts";
import { realDomainServices } from "./ports.ts";
import {
  isCancellable,
  isExpirable,
  isValidTransition,
} from "./query-transitions.ts";
import {
  MIN_ESCROW_LOCKTIME_SECS,
  validateEscrowLocktime,
  validateQueryInput,
  validateQuoteInfo,
} from "./value-objects.ts";

export { MIN_ESCROW_LOCKTIME_SECS };
import { buildChallengeRule } from "./challenge.ts";

export type TransitionResult =
  | { ok: true; query: Query }
  | { ok: false; error: string };

export interface CreateQueryAggregateOptions {
  ttlMs: number;
  requesterMeta?: RequesterMeta;
  bounty?: BountyInfo;
  oracleIds?: string[];
  escrow?: EscrowInfo;
  nostrEventId?: string;
  quorum?: QuorumConfig;
}

export function createQueryAggregate(
  input: QueryInput,
  options: CreateQueryAggregateOptions,
  services: DomainServices = realDomainServices,
): TransitionResult {
  const inputError = validateQueryInput(input);
  if (inputError) return { ok: false, error: inputError };

  const now = services.clock.now();

  if (options.escrow?.locktime) {
    const nowSecs = Math.floor(now / 1000);
    const locktimeError = validateEscrowLocktime(
      options.escrow.locktime,
      nowSecs,
      MIN_ESCROW_LOCKTIME_SECS,
    );
    if (locktimeError) return { ok: false, error: locktimeError };
  }

  const requirements = input.verification_requirements ??
    DEFAULT_VERIFICATION_FACTORS;
  const needsNonce = requirements.includes("nonce");
  const nonce = needsNonce
    ? services.nonceGenerator.newChallengeNonce()
    : undefined;
  const isEscrow = options.escrow !== undefined;

  const query: Query = {
    id: services.idGenerator.newQueryId(),
    status: isEscrow ? "awaiting_quotes" : "pending",
    description: input.description,
    location_hint: input.location_hint,
    challenge_nonce: nonce,
    challenge_rule: nonce
      ? buildChallengeRule(nonce, input.description)
      : undefined,
    verification_requirements: requirements,
    created_at: now,
    expires_at: now + options.ttlMs,
    requester_meta: options.requesterMeta,
    bounty: options.bounty,
    oracle_ids: options.oracleIds,
    payment_status: isEscrow ? "escrow_locked" : "locked",
    escrow: options.escrow,
    quotes: isEscrow ? [] : undefined,
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
  clock: Clock = realDomainServices.clock,
): TransitionResult {
  if (query.escrow !== undefined) {
    return {
      ok: false,
      error: "Use the escrow-mode functions for queries with an escrow",
    };
  }
  if (query.status !== "pending") {
    return { ok: false, error: `Query is ${query.status}, not pending` };
  }
  const now = clock.now();
  if (query.expires_at < now) {
    return {
      ok: true,
      query: { ...query, status: "expired", payment_status: "cancelled" },
    };
  }

  const newStatus: QueryStatus = verification.passed ? "approved" : "rejected";
  const paymentStatus: PaymentStatus = verification.passed
    ? "released"
    : "cancelled";
  const firstOracle = attestations?.[0]?.oracle_id ?? oracleId;

  return {
    ok: true,
    query: {
      ...query,
      status: newStatus,
      submitted_at: now,
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

// --- Escrow path ---

/** Record a worker quote for an escrow query. */
export function addQuote(query: Query, quote: QuoteInfo): TransitionResult {
  if (query.escrow === undefined) {
    return { ok: false, error: "Not an escrow query" };
  }
  if (query.status !== "awaiting_quotes") {
    return {
      ok: false,
      error: `Query is ${query.status}, not awaiting_quotes`,
    };
  }
  const quoteError = validateQuoteInfo(quote);
  if (quoteError) return { ok: false, error: quoteError };

  const quotes = [...(query.quotes ?? []), quote];
  return { ok: true, query: { ...query, quotes } };
}

/**
 * Fields that worker selection can mutate. Constrained to runtime-only
 * fields (token, verified amount, opaque ref) so callers can't switch the
 * escrow type or hashlock mid-flight.
 */
export type EscrowSelectionUpdates = Partial<
  Pick<
    EscrowInfo,
    "escrow_token" | "verified_escrow_sats" | "escrow_ref" | "worker_pubkey"
  >
>;

/** Select a worker and transition awaiting_quotes → worker_selected. */
export function selectWorker(
  query: Query,
  workerPubkey: string,
  escrowUpdates: EscrowSelectionUpdates,
): TransitionResult {
  if (query.escrow === undefined) {
    return { ok: false, error: "Not an escrow query" };
  }
  if (!isValidTransition(query.status, "worker_selected", true)) {
    return {
      ok: false,
      error: `Query is ${query.status}, not awaiting_quotes`,
    };
  }

  const escrow: EscrowInfo = {
    ...query.escrow,
    worker_pubkey: workerPubkey,
    ...escrowUpdates,
  };

  return {
    ok: true,
    query: {
      ...query,
      status: "worker_selected",
      escrow,
      payment_status: escrowUpdates.escrow_token
        ? "escrow_swapped"
        : query.payment_status,
    },
  };
}

/** Worker acknowledges selection and begins work (worker_selected → processing). */
export function beginWork(query: Query): TransitionResult {
  if (query.escrow === undefined) {
    return { ok: false, error: "Not an escrow query" };
  }
  if (!isValidTransition(query.status, "processing", true)) {
    return {
      ok: false,
      error: `Query is ${query.status}, not worker_selected`,
    };
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
  clock: Clock = realDomainServices.clock,
): TransitionResult {
  if (query.escrow === undefined) {
    return { ok: false, error: "Not an escrow query" };
  }
  if (!isValidTransition(query.status, "verifying", true)) {
    return { ok: false, error: `Query is ${query.status}, not processing` };
  }
  if (
    query.escrow.worker_pubkey && query.escrow.worker_pubkey !== workerPubkey
  ) {
    return { ok: false, error: "Worker pubkey does not match selected worker" };
  }

  return {
    ok: true,
    query: {
      ...query,
      status: "verifying",
      result,
      submitted_at: clock.now(),
      submission_meta: { executor_type: "human", channel: "adapter" },
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
  if (query.escrow === undefined) {
    return { ok: false, error: "Not an escrow query" };
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
