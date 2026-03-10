import { normalizeQueryResult } from "./attachments";
import { buildChallengeRule, generateNonce } from "./challenge";
import { resolveOracle } from "./oracle";
import {
  expirePendingQueries,
  getQueryRecord,
  insertQueryRecord,
  listQueryRecords,
  updateQueryStatusRecord,
  updateQuerySubmittedRecord,
} from "./sqlite-query-store";
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

export interface QueryStore {
  insertQuery(query: Query): void;
  getQuery(id: string): Query | null;
  listQueries(status?: QueryStatus): Query[];
  updateQuerySubmitted(
    id: string,
    result: QueryResult,
    verification: QueryVerification,
    newStatus: QueryStatus,
    paymentStatus: PaymentStatus,
    submissionMeta: QuerySubmissionMeta,
    assignedOracleId?: string,
  ): void;
  updateQueryStatus(id: string, status: QueryStatus, paymentStatus?: PaymentStatus): void;
  expirePendingQueries(): number;
}

export interface QueryService {
  createQuery(input: QueryInput, options?: CreateQueryOptions): Query;
  getQuery(id: string): Query | null;
  listOpenQueries(): Query[];
  submitQueryResult(id: string, result: QueryResult, submissionMeta: QuerySubmissionMeta, oracleId?: string): Promise<SubmitQueryOutcome>;
  cancelQuery(id: string): CancelQueryOutcome;
  expireQueries(): number;
}

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

const sqliteQueryStore: QueryStore = {
  insertQuery: insertQueryRecord,
  getQuery: getQueryRecord,
  listQueries: listQueryRecords,
  updateQuerySubmitted: updateQuerySubmittedRecord,
  updateQueryStatus: updateQueryStatusRecord,
  expirePendingQueries,
};

function resolveTtlMs(options?: CreateQueryOptions): number {
  if (!options) return DEFAULT_TTL_MS;
  if (typeof options.ttlMs === "number") return options.ttlMs;
  if (typeof options.ttlSeconds === "number") return options.ttlSeconds * 1000;
  return DEFAULT_TTL_MS;
}

function generateQueryId(): string {
  return `query_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createQueryRecord(input: QueryInput, options?: CreateQueryOptions): Query {
  const now = Date.now();
  const nonce = generateNonce();
  return {
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
}

async function submitQueryWithStore(
  store: QueryStore,
  id: string,
  result: QueryResult,
  submissionMeta: QuerySubmissionMeta,
  oracleId?: string,
): Promise<SubmitQueryOutcome> {
  const query = store.getQuery(id);
  if (!query) return { ok: false, query: null, message: "Query not found" };
  if (query.status !== "pending") return { ok: false, query, message: `Query is ${query.status}, not pending` };
  if (query.expires_at < Date.now()) {
    store.updateQueryStatus(id, "expired", "cancelled");
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

  if (attestation.passed) {
    store.updateQuerySubmitted(id, normalizedResult, verification, "approved", "released", submissionMeta, attestation.oracle_id);
    const updated = store.getQuery(id)!;
    return { ok: true, query: updated, message: "Verification passed. Result accepted." };
  }

  store.updateQuerySubmitted(id, normalizedResult, verification, "rejected", "cancelled", submissionMeta, attestation.oracle_id);
  const updated = store.getQuery(id)!;
  return {
    ok: false,
    query: updated,
    message: `Verification failed: ${attestation.failures.join(", ")}`,
  };
}

function cancelQueryWithStore(store: QueryStore, id: string): CancelQueryOutcome {
  const query = store.getQuery(id);
  if (!query) return { ok: false, message: "Query not found" };
  if (query.status !== "pending") return { ok: false, message: `Query is already ${query.status}` };
  store.updateQueryStatus(id, "rejected", "cancelled");
  return { ok: true, message: "Query cancelled" };
}

let defaultQueryService: QueryService | null = null;

export function createQueryService(store: QueryStore = sqliteQueryStore): QueryService {
  return {
    createQuery(input, options) {
      const query = createQueryRecord(input, options);
      store.insertQuery(query);
      return query;
    },
    getQuery(id) {
      return store.getQuery(id);
    },
    listOpenQueries() {
      return store.listQueries("pending").filter((query) => query.expires_at > Date.now());
    },
    async submitQueryResult(id, result, submissionMeta, oracleId) {
      return submitQueryWithStore(store, id, result, submissionMeta, oracleId);
    },
    cancelQuery(id) {
      return cancelQueryWithStore(store, id);
    },
    expireQueries() {
      return store.expirePendingQueries();
    },
  };
}

export function getDefaultQueryService(): QueryService {
  if (!defaultQueryService) {
    defaultQueryService = createQueryService();
  }
  return defaultQueryService;
}

export function createQuery(input: QueryInput, options?: CreateQueryOptions): Query {
  return getDefaultQueryService().createQuery(input, options);
}

export function getQuery(id: string): Query | null {
  return getDefaultQueryService().getQuery(id);
}

export function listOpenQueries(): Query[] {
  return getDefaultQueryService().listOpenQueries();
}

export function submitQueryResult(
  id: string,
  result: QueryResult,
  submissionMeta: QuerySubmissionMeta,
  oracleId?: string,
): Promise<SubmitQueryOutcome> {
  return getDefaultQueryService().submitQueryResult(id, result, submissionMeta, oracleId);
}

export function cancelQuery(id: string): CancelQueryOutcome {
  return getDefaultQueryService().cancelQuery(id);
}

export function expireQueries(): number {
  return getDefaultQueryService().expireQueries();
}
