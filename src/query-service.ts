import { buildChallengeRule, generateNonce } from "./challenge";
import {
  expirePendingQueries,
  getQueryRecord,
  insertQueryRecord,
  listQueryRecords,
  updateQueryStatusRecord,
  updateQuerySubmittedRecord,
} from "./sqlite-query-store";
import { normalizeQueryResult } from "./attachments";
import type {
  ExecutorType,
  PaymentStatus,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  QueryType,
  RequesterMeta,
  SubmissionMeta,
  VerificationDetail,
} from "./types";
import { verify } from "./verification";

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
  ): void;
  updateQueryStatus(id: string, status: QueryStatus, paymentStatus?: PaymentStatus): void;
  expirePendingQueries(): number;
}

export interface QueryService {
  createQuery(input: QueryInput, options?: CreateQueryOptions): Query;
  getQuery(id: string): Query | null;
  listOpenQueries(): Query[];
  submitQueryResult(id: string, result: QueryResult, submissionMeta: QuerySubmissionMeta): Promise<SubmitQueryOutcome>;
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
    payment_status: "locked",
  };
}

async function submitQueryWithStore(
  store: QueryStore,
  id: string,
  result: QueryResult,
  submissionMeta: QuerySubmissionMeta,
): Promise<SubmitQueryOutcome> {
  const query = store.getQuery(id);
  if (!query) return { ok: false, query: null, message: "Query not found" };
  if (query.status !== "pending") return { ok: false, query, message: `Query is ${query.status}, not pending` };
  if (query.expires_at < Date.now()) {
    store.updateQueryStatus(id, "expired", "cancelled");
    return { ok: false, query, message: "Query has expired" };
  }

  const normalizedResult = normalizeQueryResult(result);
  const verification = await verify(query, normalizedResult);
  const newStatus: QueryStatus = verification.passed ? "approved" : "rejected";
  const paymentStatus: PaymentStatus = verification.passed ? "released" : "cancelled";

  store.updateQuerySubmitted(id, normalizedResult, verification, newStatus, paymentStatus, submissionMeta);

  const updated = store.getQuery(id)!;
  return {
    ok: verification.passed,
    query: updated,
    message: verification.passed
      ? "Verification passed. Result accepted."
      : `Verification failed: ${verification.failures.join(", ")}`,
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
    async submitQueryResult(id, result, submissionMeta) {
      return submitQueryWithStore(store, id, result, submissionMeta);
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
): Promise<SubmitQueryOutcome> {
  return getDefaultQueryService().submitQueryResult(id, result, submissionMeta);
}

export function cancelQuery(id: string): CancelQueryOutcome {
  return getDefaultQueryService().cancelQuery(id);
}

export function expireQueries(): number {
  return getDefaultQueryService().expireQueries();
}
