import type { BlossomKeyMap } from "../../values.ts";
import { DEFAULT_VERIFICATION_FACTORS } from "../../values.ts";
import type { VerificationDetail } from "../../proofs/mod.ts";
import type {
  CustomerMeta,
  EscrowInfo,
  OfferInfo,
  OracleAttestationRecord,
  PaymentLockInfo,
  PaymentStatus,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  QuorumConfig,
  SubmissionMeta,
} from "./types.ts";
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
  validateOfferInfo,
  validateQueryInput,
} from "./value-objects.ts";

export { MIN_ESCROW_LOCKTIME_SECS };
import { buildChallengeRule } from "./challenge.ts";

export type TransitionResult =
  | { ok: true; query: Query }
  | { ok: false; error: string };

export interface CreateQueryAggregateOptions {
  ttlMs: number;
  customerMeta?: CustomerMeta;
  payment_lock?: PaymentLockInfo;
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
    status: isEscrow ? "awaiting_offers" : "pending",
    description: input.description,
    location_hint: input.location_hint,
    challenge_nonce: nonce,
    challenge_rule: nonce
      ? buildChallengeRule(nonce, input.description)
      : undefined,
    verification_requirements: requirements,
    created_at: now,
    expires_at: now + options.ttlMs,
    customer_meta: options.customerMeta,
    payment_lock: options.payment_lock,
    oracle_ids: options.oracleIds,
    payment_status: isEscrow ? "escrow_locked" : "locked",
    escrow: options.escrow,
    offers: isEscrow ? [] : undefined,
    nostr_event_id: options.nostrEventId,
    schema_requirement: input.schema_requirement,
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

/** Record a provider offer for an escrow query. */
export function addOffer(query: Query, offer: OfferInfo): TransitionResult {
  if (query.escrow === undefined) {
    return { ok: false, error: "Not an escrow query" };
  }
  if (query.status !== "awaiting_offers") {
    return {
      ok: false,
      error: `Query is ${query.status}, not awaiting_offers`,
    };
  }
  const offerError = validateOfferInfo(offer);
  if (offerError) return { ok: false, error: offerError };

  const offers = [...(query.offers ?? []), offer];
  return { ok: true, query: { ...query, offers } };
}

/**
 * Fields that provider selection can mutate. Constrained to runtime-only
 * fields (token, verified amount, opaque ref) so callers can't switch the
 * escrow type or hashlock mid-flight.
 */
export type EscrowSelectionUpdates = Partial<
  Pick<
    EscrowInfo,
    "escrow_token" | "verified_escrow_sats" | "escrow_ref" | "provider_pubkey"
  >
>;

/** Select a provider and transition awaiting_offers → provider_selected. */
export function selectProvider(
  query: Query,
  providerPubkey: string,
  escrowUpdates: EscrowSelectionUpdates,
): TransitionResult {
  if (query.escrow === undefined) {
    return { ok: false, error: "Not an escrow query" };
  }
  if (!isValidTransition(query.status, "provider_selected", true)) {
    return {
      ok: false,
      error: `Query is ${query.status}, not awaiting_offers`,
    };
  }

  const escrow: EscrowInfo = {
    ...query.escrow,
    provider_pubkey: providerPubkey,
    ...escrowUpdates,
  };

  return {
    ok: true,
    query: {
      ...query,
      status: "provider_selected",
      escrow,
      payment_status: escrowUpdates.escrow_token
        ? "escrow_swapped"
        : query.payment_status,
    },
  };
}

/** Provider acknowledges selection and begins work (provider_selected → processing). */
export function beginWork(query: Query): TransitionResult {
  if (query.escrow === undefined) {
    return { ok: false, error: "Not an escrow query" };
  }
  if (!isValidTransition(query.status, "processing", true)) {
    return {
      ok: false,
      error: `Query is ${query.status}, not provider_selected`,
    };
  }
  return {
    ok: true,
    query: { ...query, status: "processing" },
  };
}

/** Record a provider's result submission (processing → verifying). */
export function recordResult(
  query: Query,
  result: QueryResult,
  providerPubkey: string,
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
    query.escrow.provider_pubkey &&
    query.escrow.provider_pubkey !== providerPubkey
  ) {
    return {
      ok: false,
      error: "Provider pubkey does not match selected provider",
    };
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
