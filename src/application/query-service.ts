import { createQueryStore } from "../domain/query-store";
import { isOpenStatus } from "../domain/query-transitions";
import type { QueryStore } from "../domain/query-store";
import { resolveOracle } from "../infrastructure/oracle";
import type { OracleRegistry } from "../infrastructure/oracle/registry";
import type { PreimageStore } from "../infrastructure/cashu/preimage-store";
import { MIN_HTLC_LOCKTIME_SECS } from "./query-htlc-validation";
import {
  doCancelQuery,
  doCompleteVerification,
  doCreateQuery,
  doExpireQueries,
  doPurgeExpired,
  doRecordQuote,
  doRecordResult,
  doSelectWorker,
  doSubmitHtlcResult,
  doSubmitQueryResult,
} from "./query-service-methods";
import type { ServiceDeps } from "./query-service-methods";
import type {
  BlossomKeyMap,
  BountyInfo,
  ExecutorType,
  HtlcInfo,
  HtlcSubmitOutcome,
  Query,
  QueryInput,
  QueryResult,
  QuorumConfig,
  QuoteInfo,
  RequesterMeta,
  SubmissionMeta,
  VerificationDetail,
  VerificationFactor,
} from "../domain/types";

export type {
  AttachmentRef,
  AttachmentStorageKind,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  VerificationFactor,
  RequesterMeta,
  RequesterType,
} from "../domain/types";
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
  /** HTLC escrow info — when present, creates an HTLC-mode query. */
  htlc?: HtlcInfo;
  /** Nostr event ID of the kind 5300 Job Request. */
  nostrEventId?: string;
  /** Multi-oracle quorum config. */
  quorum?: QuorumConfig;
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

// --- QueryStore (extracted to domain layer) ---
export { createQueryStore, type QueryStore } from "../domain/query-store";

// --- Re-export HTLC constant for backward compatibility ---
export { MIN_HTLC_LOCKTIME_SECS } from "./query-htlc-validation";

// --- QueryService ---

export interface QueryHooks {
  onCreated?: (query: Query) => void;
}

export interface QueryServiceDeps {
  store?: QueryStore;
  oracleRegistry?: OracleRegistry;
  preimageStore?: PreimageStore;
  hooks?: QueryHooks;
}

export interface HtlcOutcome {
  ok: boolean;
  message: string;
}

export interface QueryService {
  createQuery(input: QueryInput, options?: CreateQueryOptions): Query;
  getQuery(id: string): Query | null;
  listOpenQueries(): Query[];
  listAllQueries(): Query[];
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

  // --- HTLC lifecycle ---

  /** Record a Worker quote for an HTLC query. */
  recordQuote(queryId: string, quote: QuoteInfo): HtlcOutcome;
  /** Select a Worker and transition to worker_selected/processing. */
  selectWorker(queryId: string, workerPubkey: string, htlcToken?: string): Promise<HtlcOutcome>;
  /** Record a Worker's result submission (transition to verifying). */
  recordResult(queryId: string, result: QueryResult, workerPubkey: string, blossomKeys?: BlossomKeyMap): HtlcOutcome;
  /** Complete Oracle verification (transition to approved/rejected). */
  completeVerification(queryId: string, passed: boolean, oracleId?: string): HtlcOutcome;
  /** Submit result for HTLC query with inline verification — returns preimage on success. */
  submitHtlcResult(
    queryId: string,
    result: QueryResult,
    workerPubkey: string,
    oracleId?: string,
    blossomKeys?: BlossomKeyMap,
  ): Promise<HtlcSubmitOutcome>;
}

export function createQueryService(deps?: QueryServiceDeps): QueryService {
  const store = deps?.store ?? createQueryStore();
  const registry = deps?.oracleRegistry;
  const preimageStore = deps?.preimageStore;
  const hooks = deps?.hooks;

  // Oracle resolver callbacks — passed to extracted methods so they don't close over registry.
  const oracleResolver = (oracleId: string | undefined, acceptableIds: string[] | undefined) =>
    registry ? registry.resolve(oracleId, acceptableIds) : resolveOracle(oracleId, acceptableIds);
  const multiOracleResolver = registry?.resolveMultiple?.bind(registry);

  const svcDeps: ServiceDeps = { store, oracleResolver, multiOracleResolver, preimageStore };

  return {
    createQuery: (input, options) => doCreateQuery(svcDeps, input, options, hooks),
    getQuery: (id) => store.get(id),
    listOpenQueries: () => {
      const now = Date.now();
      return store.values().filter((q) => isOpenStatus(q.status) && q.expires_at > now);
    },
    listAllQueries: () => store.values().sort((a, b) => b.created_at - a.created_at),
    submitQueryResult: (id, result, meta, oId, bk) => doSubmitQueryResult(svcDeps, id, result, meta, oId, bk),
    cancelQuery: (id) => doCancelQuery(store, id),
    expireQueries: () => doExpireQueries(store),
    purgeExpiredFromStore: () => doPurgeExpired(store),
    clearQueryStore: () => store.clear(),
    recordQuote: (queryId, quote) => doRecordQuote(store, queryId, quote),
    selectWorker: (queryId, wp, ht) => doSelectWorker(svcDeps, queryId, wp, ht),
    recordResult: (queryId, result, wp, bk) => doRecordResult(store, queryId, result, wp, bk),
    completeVerification: (queryId, passed, oId) => doCompleteVerification(store, queryId, passed, oId),
    submitHtlcResult: (queryId, result, wp, oId, bk) => doSubmitHtlcResult(svcDeps, queryId, result, wp, oId, bk),
  };
}

// --- Relay publish hook (default for production) ---

function publishQueryToRelay(query: Query): void {
  import("../infrastructure/nostr/client").then(async ({ isNostrEnabled, publishEvent }) => {
    if (!isNostrEnabled()) return;
    const { buildQueryRequestEvent } = await import("../infrastructure/nostr/events");
    const { generateEphemeralIdentity } = await import("../infrastructure/nostr/identity");

    const identity = generateEphemeralIdentity();
    const event = buildQueryRequestEvent(identity, query.id, {
      description: query.description,
      nonce: query.challenge_nonce,
      expires_at: query.expires_at,
      oracle_ids: query.oracle_ids,
      verification_requirements: query.verification_requirements,
      bounty: query.bounty?.cashu_token
        ? { mint: process.env.CASHU_MINT_URL ?? "", token: query.bounty.cashu_token }
        : undefined,
    }, query.location_hint);

    const result = await publishEvent(event);
    if (result.successes.length > 0) {
      console.error(`[relay] Query ${query.id} published to ${result.successes.length} relay(s)`);
    }
  }).catch((err) => {
    console.error("[relay] Failed to publish query:", err);
  });
}

// --- Default singleton service (backward compat) ---

export const defaultService = createQueryService({
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

export function listAllQueries(): Query[] {
  return defaultService.listAllQueries();
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
