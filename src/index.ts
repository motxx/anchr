// --- Domain ---
export { queryTemplates } from "./domain/query-templates";
export {
  cancelQuery as cancelQueryAggregate, createQueryAggregate, submitResult,
  expireQuery, addQuote, selectWorker as selectWorkerAggregate,
  recordResult, completeVerification,
} from "./domain/query-aggregate";
export type { TransitionResult, CreateQueryAggregateOptions } from "./domain/query-aggregate";
export { createInMemoryQueryRepository, toRepository } from "./domain/query-repository";
export type { QueryRepository } from "./domain/query-repository";
export { isValidTransition, isCancellable, isExpirable, isTerminal } from "./domain/query-transitions";
export {
  validateGpsCoord, validateBountyInfo, validateHtlcLocktime, validateQueryInput, validateQuoteInfo,
} from "./domain/value-objects";
export type { EscrowInfo, EscrowType, HtlcInfo, QuoteInfo } from "./domain/types";

// --- Application ---
export {
  cancelQuery, clearQueryStore, createQuery, createQueryService,
  createQueryStore, expireQueries, getQuery, listOpenQueries, submitQueryResult,
} from "./application/query-service";
export type {
  AttachmentRef, AttachmentStorageKind, CancelQueryOutcome, CreateQueryOptions,
  HtlcOutcome, Query, QueryHooks, QueryService, QueryServiceDeps, QueryStore,
  RequesterMeta, RequesterType, QueryExecutorType, QueryInput, QueryResult,
  QueryStatus, QuerySubmissionMeta, QueryVerification, SubmitQueryOutcome,
} from "./application/query-service";
export { MIN_HTLC_LOCKTIME_SECS } from "./application/query-htlc-validation";
export { purgeExpiredQueries } from "./application/data-purge";
export type { EscrowProvider } from "./application/escrow-port";

export {
  discoverQueries, submitQuote, waitForSelection, encryptAndUpload,
  publishResult, waitForPreimage,
} from "./application/worker-service";
export type { WorkerConfig, DiscoveredQuery, WorkerQueryState } from "./application/worker-service";

export {
  requestOracleHash, createHtlcQuery, subscribeToQuotes, selectWorker,
} from "./application/requester-service";
export type { RequesterConfig, CreateQueryRequest, RequesterQueryState } from "./application/requester-service";

// --- Infrastructure: Escrow providers ---
export { createCashuEscrowProvider } from "./infrastructure/cashu/cashu-escrow-provider";
export { createFrostEscrowProvider } from "./infrastructure/frost/frost-escrow-provider";

// --- Infrastructure: Preimage store ---
export { createPreimageStore, createPersistentPreimageStore } from "./infrastructure/preimage/preimage-store";
export type { PreimageStore, PreimageEntry } from "./infrastructure/preimage/preimage-store";

// --- Infrastructure: Oracle ---
export { createOracleRegistry, listOracles, getOracle, registerOracle, resolveOracle, createHttpOracle, buildOracleApp } from "./infrastructure/oracle";
export type { Oracle, OracleInfo, OracleAttestation, OracleRegistry, HttpOracleConfig } from "./infrastructure/oracle";

// --- Infrastructure: Servers & apps ---
export { startMcpServer as startMcpAdapter } from "./infrastructure/mcp-server";
export { startReferenceApp } from "./infrastructure/reference-app";
export { startReferenceRuntime } from "./infrastructure/runtime";
export { buildWorkerApiApp as buildReferenceWorkerApi, prepareWorkerApiAssets } from "./infrastructure/worker-api";
export { verify as verifyQueryResult } from "./infrastructure/verification/verifier";
export { stripExif } from "./infrastructure/exif-strip";

// --- Infrastructure: Nostr, Blossom, Verification ---
export * as nostr from "./infrastructure/nostr/index";
export * as blossom from "./infrastructure/blossom/client";
export { workerUpload } from "./infrastructure/blossom/worker-upload";
export type { WorkerUploadResult } from "./infrastructure/blossom/worker-upload";
export { fetchBlossomAttachment } from "./infrastructure/blossom/fetch-attachment";
export * as verification from "./infrastructure/verification/index";

// --- Infrastructure: Oracle Nostr service ---
export { createOracleNostrService, createOracleNostrServiceFromEnv } from "./infrastructure/oracle/oracle-nostr-service";
export type { OracleNostrServiceConfig, OracleNostrService } from "./infrastructure/oracle/oracle-nostr-service";

if (import.meta.main) {
  await import("./infrastructure/server");
}
