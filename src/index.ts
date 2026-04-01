export { queryTemplates } from "./domain/query-templates";
export {
  cancelQuery,
  clearQueryStore,
  createQuery,
  createQueryService,
  createQueryStore,
  expireQueries,
  getQuery,
  listOpenQueries,
  submitQueryResult,
} from "./application/query-service";
export type {
  AttachmentRef,
  AttachmentStorageKind,
  CancelQueryOutcome,
  CreateQueryOptions,
  HtlcOutcome,
  Query,
  QueryHooks,
  QueryService,
  QueryServiceDeps,
  QueryStore,
  RequesterMeta,
  RequesterType,
  QueryExecutorType,
  QueryInput,
  QueryResult,
  QueryStatus,
  QuerySubmissionMeta,
  QueryVerification,
  SubmitQueryOutcome,
} from "./application/query-service";
export type { HtlcInfo, QuoteInfo } from "./domain/types";
export { isValidTransition, isCancellable, isExpirable, isTerminal } from "./domain/query-transitions";
export {
  validateGpsCoord, validateBountyInfo, validateHtlcLocktime, validateQueryInput, validateQuoteInfo,
} from "./domain/value-objects";
export {
  createQueryAggregate, submitResult, expireQuery, cancelQuery as cancelQueryAggregate,
  addQuote, selectWorker as selectWorkerAggregate, recordResult, completeVerification,
} from "./domain/query-aggregate";
export type { TransitionResult, CreateQueryAggregateOptions } from "./domain/query-aggregate";
export { createInMemoryQueryRepository, toRepository } from "./domain/query-repository";
export type { QueryRepository } from "./domain/query-repository";
export { startMcpServer as startMcpAdapter } from "./infrastructure/mcp-server";
export { startReferenceApp } from "./infrastructure/reference-app";
export { startReferenceRuntime } from "./infrastructure/runtime";
export { buildWorkerApiApp as buildReferenceWorkerApi, prepareWorkerApiAssets } from "./infrastructure/worker-api";
export { verify as verifyQueryResult } from "./infrastructure/verification/verifier";
export { createOracleRegistry, listOracles, getOracle, registerOracle, resolveOracle, createHttpOracle, buildOracleApp } from "./infrastructure/oracle";
export type { Oracle, OracleInfo, OracleAttestation, OracleRegistry, HttpOracleConfig } from "./infrastructure/oracle";
export { stripExif } from "./infrastructure/exif-strip";
export { purgeExpiredQueries } from "./application/data-purge";
export { isCashuEnabled, getCashuConfig, verifyToken, encodeToken } from "./infrastructure/cashu/wallet";
export {
  buildEscrowP2PKOptions, calculateOracleFee, createEscrowToken, executeEscrowSwap, inspectEscrowToken,
  buildHtlcInitialOptions, buildHtlcFinalOptions, createHtlcToken, swapHtlcBindWorker, redeemHtlcToken,
} from "./infrastructure/cashu/escrow";
export type { EscrowParams, EscrowToken, SwapResult, HtlcInitialLockParams, HtlcWorkerBindParams } from "./infrastructure/cashu/escrow";
export { createPreimageStore } from "./infrastructure/cashu/preimage-store";
export type { PreimageStore, PreimageEntry } from "./infrastructure/cashu/preimage-store";
export * as nostr from "./infrastructure/nostr/index";
export * as blossom from "./infrastructure/blossom/client";
export { workerUpload } from "./infrastructure/blossom/worker-upload";
export type { WorkerUploadResult } from "./infrastructure/blossom/worker-upload";
export { fetchBlossomAttachment } from "./infrastructure/blossom/fetch-attachment";
export * as verification from "./infrastructure/verification/index";
export {
  discoverQueries,
  submitQuote,
  waitForSelection,
  encryptAndUpload,
  publishResult,
  waitForPreimage,
} from "./application/worker-service";
export type { WorkerConfig, DiscoveredQuery, WorkerQueryState } from "./application/worker-service";
export {
  requestOracleHash,
  createHtlcQuery,
  subscribeToQuotes,
  selectWorker,
} from "./application/requester-service";
export type { RequesterConfig, CreateQueryRequest, RequesterQueryState } from "./application/requester-service";
export { createOracleNostrService, createOracleNostrServiceFromEnv } from "./infrastructure/oracle/oracle-nostr-service";
export type { OracleNostrServiceConfig, OracleNostrService } from "./infrastructure/oracle/oracle-nostr-service";

if (import.meta.main) {
  await import("./infrastructure/server");
}
