import { createQueryStore } from "../domain/query-store.ts";
import { isOpenStatus } from "../domain/query-transitions.ts";
import type { QueryStore } from "../domain/query-store.ts";
import type { PreimageStore } from "../../payments/mod.ts";
import type {
  EscrowProvider,
  FrostSignaturePort,
  OracleRegistry,
  ProofDelivery,
} from "./ports.ts";
import { MIN_ESCROW_LOCKTIME_SECS } from "./query-escrow-validation.ts";
import {
  doCancelQuery,
  doCreateQuery,
  doExpireQueries,
  doPurgeExpired,
  doSubmitQueryResult,
} from "./query-lifecycle-methods.ts";
import {
  doBeginWork,
  doCompleteVerification,
  doRecordOffer,
  doRecordResult,
  doSelectWorker,
  doSubmitEscrowResult,
} from "./escrow-flow-methods.ts";
import type { ServiceDeps } from "./query-service-deps.ts";
import type {
  BlossomKeyMap,
  BountyInfo,
  EscrowInfo,
  EscrowSubmitOutcome,
  ExecutorType,
  OfferInfo,
  Query,
  QueryInput,
  QueryResult,
  QuorumConfig,
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
  RequesterMeta,
  RequesterType,
  VerificationFactor,
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

export { createQueryStore, type QueryStore } from "../domain/query-store.ts";

export interface QueryHooks {
  onCreated?: (query: Query) => void;
}

export interface QueryServiceDeps {
  store?: QueryStore;
  oracleRegistry?: OracleRegistry;
  preimageStore?: PreimageStore;
  escrowProvider?: EscrowProvider;
  /** FROST coordinator port — used for P2PK+FROST settlement on success. */
  frostSignature?: FrostSignaturePort;
  hooks?: QueryHooks;
  proofDelivery?: ProofDelivery;
  /** Defaults to identity. */
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

  recordOffer(queryId: string, offer: OfferInfo): HtlcOutcome;
  selectWorker(
    queryId: string,
    workerPubkey: string,
    escrowToken?: string,
  ): Promise<HtlcOutcome>;
  beginWork(queryId: string): HtlcOutcome;
  recordResult(
    queryId: string,
    result: QueryResult,
    workerPubkey: string,
    blossomKeys?: BlossomKeyMap,
  ): HtlcOutcome;
  completeVerification(
    queryId: string,
    passed: boolean,
    oracleId?: string,
  ): HtlcOutcome;
  /** Returns preimage on success. */
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
  const frostSignature = deps?.frostSignature;
  const hooks = deps?.hooks;
  const proofDelivery = deps?.proofDelivery;

  const oracleResolver = (
    oracleId: string | undefined,
    acceptableIds: string[] | undefined,
  ) => registry ? registry.resolve(oracleId, acceptableIds) : null;
  const multiOracleResolver = registry?.resolveMultiple?.bind(registry);

  const normalizeResult = deps?.normalizeResult;
  const svcDeps: ServiceDeps = {
    store,
    oracleResolver,
    multiOracleResolver,
    preimageStore,
    escrowProvider,
    frostSignature,
    proofDelivery,
    normalizeResult,
  };

  return {
    createQuery: (input, options) =>
      doCreateQuery(svcDeps, input, options, hooks),
    getQuery: (id) => store.get(id),
    listOpenQueries: () => {
      const now = Date.now();
      return store.values().filter((q) =>
        isOpenStatus(q.status) && q.expires_at > now
      );
    },
    listAllQueries: () =>
      store.values().sort((a, b) => b.created_at - a.created_at),
    submitQueryResult: (id, result, meta, oId, bk) =>
      doSubmitQueryResult(svcDeps, id, result, meta, oId, bk),
    cancelQuery: (id) => doCancelQuery(store, id),
    expireQueries: () => doExpireQueries(store),
    purgeExpiredFromStore: () => doPurgeExpired(store),
    clearQueryStore: () => store.clear(),
    recordOffer: (queryId, offer) => doRecordOffer(store, queryId, offer),
    selectWorker: (queryId, wp, ht) => doSelectWorker(svcDeps, queryId, wp, ht),
    beginWork: (queryId) => doBeginWork(store, queryId),
    recordResult: (queryId, result, wp, bk) =>
      doRecordResult(svcDeps, queryId, result, wp, bk),
    completeVerification: (queryId, passed, oId) =>
      doCompleteVerification(store, queryId, passed, oId),
    submitEscrowResult: (queryId, result, wp, oId, bk) =>
      doSubmitEscrowResult(svcDeps, queryId, result, wp, oId, bk),
  };
}
