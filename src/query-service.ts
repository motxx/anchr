import { normalizeQueryResult } from "./attachments";
import { buildChallengeRule, generateNonce } from "./challenge";
import { resolveOracle } from "./oracle";
import type { OracleRegistry } from "./oracle/registry";
import type {
  BlossomKeyMap,
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

// --- QueryStore interface ---

export interface QueryStore {
  get(id: string): Query | null;
  set(id: string, query: Query): void;
  values(): Query[];
  delete(id: string): void;
  clear(): void;
}

export function createQueryStore(): QueryStore {
  const queries = new Map<string, Query>();
  return {
    get: (id) => queries.get(id) ?? null,
    set: (id, query) => { queries.set(id, query); },
    values: () => Array.from(queries.values()),
    delete: (id) => { queries.delete(id); },
    clear: () => { queries.clear(); },
  };
}

// --- QueryService ---

export interface QueryHooks {
  onCreated?: (query: Query) => void;
}

export interface QueryServiceDeps {
  store?: QueryStore;
  oracleRegistry?: OracleRegistry;
  hooks?: QueryHooks;
}

export interface QueryService {
  createQuery(input: QueryInput, options?: CreateQueryOptions): Query;
  getQuery(id: string): Query | null;
  listOpenQueries(): Query[];
  submitQueryResult(
    id: string,
    result: QueryResult,
    submissionMeta: SubmissionMeta,
    oracleId?: string,
    blossomKeys?: BlossomKeyMap,
  ): Promise<SubmitQueryOutcome>;
  cancelQuery(id: string): CancelQueryOutcome;
  expireQueries(): number;
  purgeExpiredFromStore(): Query[];
  clearQueryStore(): void;
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

function resolveTtlMs(options?: CreateQueryOptions): number {
  if (!options) return DEFAULT_TTL_MS;
  if (typeof options.ttlMs === "number") return options.ttlMs;
  if (typeof options.ttlSeconds === "number") return options.ttlSeconds * 1000;
  return DEFAULT_TTL_MS;
}

function generateQueryId(): string {
  return `query_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createQueryService(deps?: QueryServiceDeps): QueryService {
  const store = deps?.store ?? createQueryStore();
  const registry = deps?.oracleRegistry;
  const hooks = deps?.hooks;

  function doResolveOracle(oracleId: string | undefined, acceptableIds: string[] | undefined) {
    return registry
      ? registry.resolve(oracleId, acceptableIds)
      : resolveOracle(oracleId, acceptableIds);
  }

  return {
    createQuery(input: QueryInput, options?: CreateQueryOptions): Query {
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

      store.set(query.id, query);
      hooks?.onCreated?.(query);
      return query;
    },

    getQuery(id: string): Query | null {
      return store.get(id);
    },

    listOpenQueries(): Query[] {
      const now = Date.now();
      return store.values().filter((q) => q.status === "pending" && q.expires_at > now);
    },

    async submitQueryResult(
      id: string,
      result: QueryResult,
      submissionMeta: SubmissionMeta,
      oracleId?: string,
      blossomKeys?: BlossomKeyMap,
    ): Promise<SubmitQueryOutcome> {
      const query = store.get(id);
      if (!query) return { ok: false, query: null, message: "Query not found" };
      if (query.status !== "pending") return { ok: false, query, message: `Query is ${query.status}, not pending` };
      if (query.expires_at < Date.now()) {
        store.set(id, { ...query, status: "expired", payment_status: "cancelled" });
        return { ok: false, query, message: "Query has expired" };
      }

      const oracle = doResolveOracle(oracleId, query.oracle_ids);
      if (!oracle) {
        return { ok: false, query, message: oracleId
          ? `Oracle "${oracleId}" is not available or not accepted for this query`
          : "No oracle available for this query" };
      }

      const normalizedResult = normalizeQueryResult(result);
      const attestation = await oracle.verify(query, normalizedResult, blossomKeys);
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
      store.set(id, updated);

      return {
        ok: attestation.passed,
        query: updated,
        message: attestation.passed
          ? "Verification passed. Result accepted."
          : `Verification failed: ${attestation.failures.join(", ")}`,
      };
    },

    cancelQuery(id: string): CancelQueryOutcome {
      const query = store.get(id);
      if (!query) return { ok: false, message: "Query not found" };
      if (query.status !== "pending") return { ok: false, message: `Query is already ${query.status}` };
      store.set(id, { ...query, status: "rejected", payment_status: "cancelled" });
      return { ok: true, message: "Query cancelled" };
    },

    expireQueries(): number {
      const now = Date.now();
      let count = 0;
      for (const query of store.values()) {
        if (query.status === "pending" && query.expires_at < now) {
          store.set(query.id, { ...query, status: "expired", payment_status: "cancelled" });
          count++;
        }
      }
      return count;
    },

    purgeExpiredFromStore(): Query[] {
      const expired: Query[] = [];
      for (const query of store.values()) {
        if (query.status === "expired") {
          expired.push(query);
          store.delete(query.id);
        }
      }
      return expired;
    },

    clearQueryStore(): void {
      store.clear();
    },
  };
}

// --- Relay publish hook (default for production) ---

function publishQueryToRelay(query: Query): void {
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

// --- Default singleton service (backward compat) ---

const defaultService = createQueryService({
  hooks: { onCreated: publishQueryToRelay },
});

export function createQuery(input: QueryInput, options?: CreateQueryOptions): Query {
  return defaultService.createQuery(input, options);
}

export function getQuery(id: string): Query | null {
  return defaultService.getQuery(id);
}

export function listOpenQueries(): Query[] {
  return defaultService.listOpenQueries();
}

export async function submitQueryResult(
  id: string,
  result: QueryResult,
  submissionMeta: SubmissionMeta,
  oracleId?: string,
  blossomKeys?: BlossomKeyMap,
): Promise<SubmitQueryOutcome> {
  return defaultService.submitQueryResult(id, result, submissionMeta, oracleId, blossomKeys);
}

export function cancelQuery(id: string): CancelQueryOutcome {
  return defaultService.cancelQuery(id);
}

export function expireQueries(): number {
  return defaultService.expireQueries();
}

export function purgeExpiredFromStore(): Query[] {
  return defaultService.purgeExpiredFromStore();
}

export function clearQueryStore(): void {
  defaultService.clearQueryStore();
}
