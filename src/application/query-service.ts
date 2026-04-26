import { createQueryStore } from "../domain/query-store.ts";
import { isOpenStatus } from "../domain/query-transitions.ts";
import type { QueryStore } from "../domain/query-store.ts";
import type { OracleRegistry } from "./oracle-port.ts";
import type { PreimageStore } from "@anchr/core-cashu/preimage-port";
import type { EscrowProvider } from "./escrow-port.ts";
import type { ProofDelivery } from "./proof-delivery.ts";
import { MIN_ESCROW_LOCKTIME_SECS } from "./query-escrow-validation.ts";
import {
  doBeginWork,
  doCancelQuery,
  doCompleteVerification,
  doCreateQuery,
  doExpireQueries,
  doPurgeExpired,
  doRecordQuote,
  doRecordResult,
  doSelectWorker,
  doSubmitEscrowResult,
  doSubmitQueryResult,
} from "./query-service-methods.ts";
import type { ServiceDeps } from "./query-service-methods.ts";
import type {
  BlossomKeyMap,
  BountyInfo,
  EscrowInfo,
  ExecutorType,
  EscrowSubmitOutcome,
  Query,
  QueryInput,
  QueryResult,
  QuorumConfig,
  QuoteInfo,
  RequesterMeta,
  SubmissionMeta,
  VerificationDetail,
  VerificationFactor,
} from "../domain/types.ts";

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
} from "../domain/types.ts";
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
  /** Escrow info — when present, creates an escrow-mode (HTLC or P2PK+FROST) query. */
  escrow?: EscrowInfo;
  /** Nostr event ID of the kind 5300 Job Request. */
  nostrEventId?: string;
  /** Multi-oracle quorum config. When set with FROST, oracle_ids become FROST signers. */
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
export { createQueryStore, type QueryStore } from "../domain/query-store.ts";

// --- QueryService ---

export interface QueryHooks {
  onCreated?: (query: Query) => void;
}

export interface QueryServiceDeps {
  store?: QueryStore;
  oracleRegistry?: OracleRegistry;
  preimageStore?: PreimageStore;
  escrowProvider?: EscrowProvider;
  hooks?: QueryHooks;
  proofDelivery?: ProofDelivery;
  /** Normalize attachment refs in a QueryResult. Defaults to identity. */
  normalizeResult?: (result: QueryResult, requestUrl?: string) => QueryResult;
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
  /** Select a Worker and transition to worker_selected. */
  selectWorker(queryId: string, workerPubkey: string, escrowToken?: string): Promise<HtlcOutcome>;
  /** Worker acknowledges selection and begins work (worker_selected → processing). */
  beginWork(queryId: string): HtlcOutcome;
  /** Record a Worker's result submission (transition to verifying). */
  recordResult(queryId: string, result: QueryResult, workerPubkey: string, blossomKeys?: BlossomKeyMap): HtlcOutcome;
  /** Complete Oracle verification (transition to approved/rejected). */
  completeVerification(queryId: string, passed: boolean, oracleId?: string): HtlcOutcome;
  /** Submit result for HTLC query with inline verification — returns preimage on success. */
  submitEscrowResult(
    queryId: string,
    result: QueryResult,
    workerPubkey: string,
    oracleId?: string,
    blossomKeys?: BlossomKeyMap,
  ): Promise<EscrowSubmitOutcome>;
}

export function createQueryService(deps?: QueryServiceDeps): QueryService {
  const store = deps?.store ?? createQueryStore();
  const registry = deps?.oracleRegistry;
  const preimageStore = deps?.preimageStore;
  const escrowProvider = deps?.escrowProvider;
  const hooks = deps?.hooks;
  const proofDelivery = deps?.proofDelivery;

  // Oracle resolver callbacks — passed to extracted methods so they don't close over registry.
  const oracleResolver = (oracleId: string | undefined, acceptableIds: string[] | undefined) =>
    registry ? registry.resolve(oracleId, acceptableIds) : null;
  const multiOracleResolver = registry?.resolveMultiple?.bind(registry);

  const normalizeResult = deps?.normalizeResult;
  const svcDeps: ServiceDeps = { store, oracleResolver, multiOracleResolver, preimageStore, escrowProvider, proofDelivery, normalizeResult };

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
    beginWork: (queryId) => doBeginWork(store, queryId),
    recordResult: (queryId, result, wp, bk) => doRecordResult(svcDeps, queryId, result, wp, bk),
    completeVerification: (queryId, passed, oId) => doCompleteVerification(store, queryId, passed, oId),
    submitEscrowResult: (queryId, result, wp, oId, bk) => doSubmitEscrowResult(svcDeps, queryId, result, wp, oId, bk),
  };
}

