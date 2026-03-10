import { normalizeQueryResult } from "./attachments";
import { buildChallengeRule, generateNonce } from "./challenge";
import { resolveOracle } from "./oracle";
import type {
  BountyInfo,
  ExecutorType,
  PaymentStatus,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  RequesterMeta,
  SubmissionMeta,
  VerificationDetail,
} from "./types";

export type {
  AttachmentRef,
  AttachmentStorageKind,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  QueryType,
  RequesterMeta,
  RequesterType,
} from "./types";
export type QueryVerification = VerificationDetail;
export type QueryExecutorType = ExecutorType;
export type QuerySubmissionMeta = SubmissionMeta;

export interface CreateQueryOptions {
  ttlMs?: number;
  ttlSeconds?: number;
  requesterMeta?: RequesterMeta;
  bounty?: BountyInfo;
  /** Acceptable oracle IDs. Empty/undefined = any (defaults to built-in). */
  oracleIds?: string[];
}

export interface SubmitQueryOutcome {
  ok: boolean;
  query: Query | null;
  message: string;
}

export interface CancelQueryOutcome {
  ok: boolean;
  message: string;
}

// --- In-memory query store ---

const queries = new Map<string, Query>();

/** Clear all queries (for testing). */
export function clearQueryStore(): void {
  queries.clear();
}

// --- Relay sync (fire-and-forget) ---

function publishQueryToRelay(query: Query): void {
  // Lazy-import to avoid circular deps and keep sync API
  import("./nostr/client").then(async ({ isNostrEnabled, publishEvent }) => {
    if (!isNostrEnabled()) return;
    const { buildQueryRequestEvent } = await import("./nostr/events");
    const { generateEphemeralIdentity } = await import("./nostr/identity");

    const identity = generateEphemeralIdentity();
    const params = query.params as unknown as Record<string, unknown>;
    const event = buildQueryRequestEvent(identity, query.id, {
      type: query.type,
      params,
      nonce: query.challenge_nonce,
      expires_at: query.expires_at,
      oracle_ids: query.oracle_ids,
      bounty: query.bounty?.cashu_token
        ? { mint: process.env.CASHU_MINT_URL ?? "", token: query.bounty.cashu_token }
        : undefined,
    }, params.location_hint as string | undefined);

    const result = await publishEvent(event);
    if (result.successes.length > 0) {
      console.error(`[relay] Query ${query.id} published to ${result.successes.length} relay(s)`);
    }
  }).catch((err) => {
    console.error("[relay] Failed to publish query:", err);
  });
}

// --- Query templates ---

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export const queryTemplates = {
  photoProof: (target: string, locationHint?: string): QueryInput => ({
    type: "photo_proof",
    target,
    location_hint: locationHint,
  }),
  storeStatus: (storeName: string, locationHint?: string): QueryInput => ({
    type: "store_status",
    store_name: storeName,
    location_hint: locationHint,
  }),
  webpageField: (url: string, field: string, anchorWord: string): QueryInput => ({
    type: "webpage_field",
    url,
    field,
    anchor_word: anchorWord,
  }),
} as const;

// --- Core logic ---

function resolveTtlMs(options?: CreateQueryOptions): number {
  if (!options) return DEFAULT_TTL_MS;
  if (typeof options.ttlMs === "number") return options.ttlMs;
  if (typeof options.ttlSeconds === "number") return options.ttlSeconds * 1000;
  return DEFAULT_TTL_MS;
}

function generateQueryId(): string {
  return `query_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createQuery(input: QueryInput, options?: CreateQueryOptions): Query {
  const now = Date.now();
  const nonce = generateNonce();
  const query: Query = {
    id: generateQueryId(),
    type: input.type,
    status: "pending",
    params: input,
    challenge_nonce: nonce,
    challenge_rule: buildChallengeRule(input.type, nonce, input as unknown as Record<string, unknown>),
    created_at: now,
    expires_at: now + resolveTtlMs(options),
    requester_meta: options?.requesterMeta,
    bounty: options?.bounty,
    oracle_ids: options?.oracleIds,
    payment_status: "locked",
  };

  queries.set(query.id, query);
  publishQueryToRelay(query);
  return query;
}

export function getQuery(id: string): Query | null {
  return queries.get(id) ?? null;
}

export function listOpenQueries(): Query[] {
  const now = Date.now();
  return Array.from(queries.values())
    .filter((q) => q.status === "pending" && q.expires_at > now);
}

export async function submitQueryResult(
  id: string,
  result: QueryResult,
  submissionMeta: SubmissionMeta,
  oracleId?: string,
): Promise<SubmitQueryOutcome> {
  const query = queries.get(id);
  if (!query) return { ok: false, query: null, message: "Query not found" };
  if (query.status !== "pending") return { ok: false, query, message: `Query is ${query.status}, not pending` };
  if (query.expires_at < Date.now()) {
    queries.set(id, { ...query, status: "expired", payment_status: "cancelled" });
    return { ok: false, query, message: "Query has expired" };
  }

  const oracle = resolveOracle(oracleId, query.oracle_ids);
  if (!oracle) {
    return { ok: false, query, message: oracleId
      ? `Oracle "${oracleId}" is not available or not accepted for this query`
      : "No oracle available for this query" };
  }

  const normalizedResult = normalizeQueryResult(result);
  const attestation = await oracle.verify(query, normalizedResult);
  const verification: VerificationDetail = {
    passed: attestation.passed,
    checks: attestation.checks,
    failures: attestation.failures,
  };

  const newStatus: QueryStatus = attestation.passed ? "approved" : "rejected";
  const paymentStatus: PaymentStatus = attestation.passed ? "released" : "cancelled";
  const updated: Query = {
    ...query,
    status: newStatus,
    submitted_at: Date.now(),
    result: normalizedResult,
    verification,
    submission_meta: submissionMeta,
    payment_status: paymentStatus,
    assigned_oracle_id: attestation.oracle_id,
  };
  queries.set(id, updated);

  return {
    ok: attestation.passed,
    query: updated,
    message: attestation.passed
      ? "Verification passed. Result accepted."
      : `Verification failed: ${attestation.failures.join(", ")}`,
  };
}

export function cancelQuery(id: string): CancelQueryOutcome {
  const query = queries.get(id);
  if (!query) return { ok: false, message: "Query not found" };
  if (query.status !== "pending") return { ok: false, message: `Query is already ${query.status}` };
  queries.set(id, { ...query, status: "rejected", payment_status: "cancelled" });
  return { ok: true, message: "Query cancelled" };
}

export function expireQueries(): number {
  const now = Date.now();
  let count = 0;
  for (const [id, query] of queries) {
    if (query.status === "pending" && query.expires_at < now) {
      queries.set(id, { ...query, status: "expired", payment_status: "cancelled" });
      count++;
    }
  }
  return count;
}

/** List expired queries and remove them from the store. Returns removed query IDs. */
export function purgeExpiredFromStore(): Query[] {
  const expired: Query[] = [];
  for (const [id, query] of queries) {
    if (query.status === "expired") {
      expired.push(query);
      queries.delete(id);
    }
  }
  return expired;
}
