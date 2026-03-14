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
} from "./query-service";
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
} from "./query-service";
export type { HtlcInfo, QuoteInfo } from "./types";
export { startMcpServer as startMcpAdapter } from "./mcp-server";
export { startReferenceApp } from "./reference-app";
export { startReferenceRuntime } from "./runtime";
export { buildWorkerApiApp as buildReferenceWorkerApi, prepareWorkerApiAssets } from "./worker-api";
export { verify as verifyQueryResult } from "./verification/verifier";
export { createOracleRegistry, listOracles, getOracle, registerOracle, resolveOracle, createHttpOracle, buildOracleApp } from "./oracle";
export type { Oracle, OracleInfo, OracleAttestation, OracleRegistry, HttpOracleConfig } from "./oracle";
export { stripExif } from "./exif-strip";
export { purgeExpiredQueries } from "./data-purge";
export { isCashuEnabled, getCashuConfig, verifyToken, encodeToken } from "./cashu/wallet";
export {
  buildEscrowP2PKOptions, calculateOracleFee, createEscrowToken, executeEscrowSwap, inspectEscrowToken,
  buildHtlcInitialOptions, buildHtlcFinalOptions, createHtlcToken, swapHtlcBindWorker, redeemHtlcToken,
} from "./cashu/escrow";
export type { EscrowParams, EscrowToken, SwapResult, HtlcInitialLockParams, HtlcWorkerBindParams } from "./cashu/escrow";
export { createPreimageStore } from "./oracle/preimage-store";
export type { PreimageStore, PreimageEntry } from "./oracle/preimage-store";
export * as nostr from "./nostr/index";
export * as blossom from "./blossom/client";
export { workerUpload } from "./blossom/worker-upload";
export type { WorkerUploadResult } from "./blossom/worker-upload";
export { fetchBlossomAttachment } from "./blossom/fetch-attachment";
export * as verification from "./verification/index";
export {
  discoverQueries,
  submitQuote,
  waitForSelection,
  encryptAndUpload,
  publishResult,
  waitForPreimage,
} from "./worker-service";
export type { WorkerConfig, DiscoveredQuery, WorkerQueryState } from "./worker-service";
export {
  requestOracleHash,
  createHtlcQuery,
  subscribeToQuotes,
  selectWorker,
} from "./requester-service";
export type { RequesterConfig, CreateQueryRequest, RequesterQueryState } from "./requester-service";
export { createOracleNostrService, createOracleNostrServiceFromEnv } from "./oracle/oracle-nostr-service";
export type { OracleNostrServiceConfig, OracleNostrService } from "./oracle/oracle-nostr-service";

if (import.meta.main) {
  await import("./server");
}
