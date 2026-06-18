import { createQueryStore } from "../domain/query-store.ts";
import { isOpenStatus } from "../domain/query-transitions.ts";
import type { QueryStore } from "../domain/query-store.ts";
import type {
  EscrowProvider,
  FrostSignaturePort,
  OracleRegistry,
  PreimageStore,
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
  doSelectProvider,
  doSubmitEscrowResult,
} from "./escrow-flow-methods.ts";
import type { ServiceDeps } from "./query-service-deps.ts";
import type {
  CancelQueryOutcome,
  CreateQueryOptions,
  HtlcOutcome,
  QueryHooks,
  SubmitQueryOutcome,
} from "./query-service-types.ts";
import type { BlossomKeyMap, VerificationFactor } from "../../values.ts";
import type {
  EscrowSubmitOutcome,
  OfferInfo,
  Query,
  QueryInput,
  QueryResult,
  SubmissionMeta,
} from "../domain/types.ts";

export type {
  AttachmentRef,
  AttachmentStorageKind,
  VerificationFactor,
} from "../../values.ts";
export type {
  CustomerMeta,
  CustomerType,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
} from "../domain/types.ts";

export type { CreateQueryOptions } from "./query-service-types.ts";
export type { SubmitQueryOutcome } from "./query-service-types.ts";
export type { CancelQueryOutcome } from "./query-service-types.ts";

export { createQueryStore, type QueryStore } from "../domain/query-store.ts";

export type { QueryHooks } from "./query-service-types.ts";

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

export type { HtlcOutcome } from "./query-service-types.ts";

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
  /**
   * Transition past-deadline open queries to `expired`. The service runs no
   * built-in timer — a long-running host calls this (and
   * `purgeExpiredFromStore`) on its own schedule.
   */
  expireQueries(): number;
  purgeExpiredFromStore(): Query[];
  clearQueryStore(): void;

  recordOffer(queryId: string, offer: OfferInfo): HtlcOutcome;
  selectProvider(
    queryId: string,
    providerPubkey: string,
    escrowToken?: string,
  ): Promise<HtlcOutcome>;
  beginWork(queryId: string): HtlcOutcome;
  recordResult(
    queryId: string,
    result: QueryResult,
    providerPubkey: string,
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
    providerPubkey: string,
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
    selectProvider: (queryId, wp, ht) =>
      doSelectProvider(svcDeps, queryId, wp, ht),
    beginWork: (queryId) => doBeginWork(store, queryId),
    recordResult: (queryId, result, wp, bk) =>
      doRecordResult(svcDeps, queryId, result, wp, bk),
    completeVerification: (queryId, passed, oId) =>
      doCompleteVerification(store, queryId, passed, oId),
    submitEscrowResult: (queryId, result, wp, oId, bk) =>
      doSubmitEscrowResult(svcDeps, queryId, result, wp, oId, bk),
  };
}
