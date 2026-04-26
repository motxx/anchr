// --- Domain ---
export { queryTemplates } from "./domain/query-templates.ts";
export {
  cancelQuery as cancelQueryAggregate, createQueryAggregate, submitResult,
  expireQuery, addQuote, selectWorker as selectWorkerAggregate,
  recordResult, completeVerification,
} from "./domain/query-aggregate.ts";
export type { TransitionResult, CreateQueryAggregateOptions } from "./domain/query-aggregate.ts";
export { createInMemoryQueryRepository, toRepository } from "./domain/query-repository.ts";
export type { QueryRepository } from "./domain/query-repository.ts";
export { isValidTransition, isCancellable, isExpirable, isTerminal } from "./domain/query-transitions.ts";
export {
  validateGpsCoord, validateBountyInfo, validateHtlcLocktime, validateQueryInput, validateQuoteInfo,
} from "./domain/value-objects.ts";
export type { EscrowInfo, EscrowType, HtlcInfo, QuoteInfo } from "./domain/types.ts";

// --- Application ---
export {
  cancelQuery, clearQueryStore, createQuery, createQueryService,
  createQueryStore, expireQueries, getQuery, listOpenQueries, submitQueryResult,
  setDefaultService,
} from "./application/query-service.ts";
export type {
  AttachmentRef, AttachmentStorageKind, CancelQueryOutcome, CreateQueryOptions,
  HtlcOutcome, Query, QueryHooks, QueryService, QueryServiceDeps, QueryStore,
  RequesterMeta, RequesterType, QueryExecutorType, QueryInput, QueryResult,
  QueryStatus, QuerySubmissionMeta, QueryVerification, SubmitQueryOutcome,
} from "./application/query-service.ts";
export { MIN_HTLC_LOCKTIME_SECS } from "./application/query-htlc-validation.ts";
export { purgeExpiredQueries } from "./application/data-purge.ts";
export type { EscrowProvider } from "./application/escrow-port.ts";

export {
  discoverQueries, submitQuote, waitForSelection, encryptAndUpload,
  publishResult, waitForPreimage,
} from "./infrastructure/nostr/worker-service.ts";
export type { WorkerConfig, DiscoveredQuery, WorkerQueryState } from "./infrastructure/nostr/worker-service.ts";

export {
  requestOracleHash, createHtlcQuery, subscribeToQuotes, selectWorker,
} from "./infrastructure/nostr/requester-service.ts";
export type { RequesterConfig, CreateQueryRequest, RequesterQueryState } from "./infrastructure/nostr/requester-service.ts";

// --- Infrastructure: Escrow providers ---
export { createCashuEscrowProvider } from "./infrastructure/cashu/cashu-escrow-provider.ts";
export { createFrostEscrowProvider } from "./infrastructure/frost/frost-escrow-provider.ts";

// --- Application: Preimage port ---
export type { PreimageStore, PreimageEntry } from "@anchr/core-cashu/preimage-port";
// --- Infrastructure: Preimage store ---
export { createPreimageStore, createPersistentPreimageStore } from "@anchr/core-cashu/preimage-store";

// --- Application: Oracle port ---
export type { OracleRegistry } from "./application/oracle-port.ts";
// --- Infrastructure: Oracle ---
export { createOracleRegistry, listOracles, getOracle, registerOracle, resolveOracle, createHttpOracle, buildOracleApp } from "./infrastructure/oracle/index.ts";
export type { Oracle, OracleInfo, OracleAttestation, HttpOracleConfig } from "./infrastructure/oracle/index.ts";

// --- Infrastructure: Servers & apps ---
export { startMcpServer as startMcpAdapter } from "./infrastructure/mcp-server.ts";
export { startReferenceApp } from "./infrastructure/reference-app.ts";
export { startReferenceRuntime } from "./infrastructure/runtime.ts";
export { buildWorkerApiApp as buildReferenceWorkerApi, prepareWorkerApiAssets } from "./infrastructure/worker-api.ts";
export { verify as verifyQueryResult } from "./infrastructure/verification/verifier.ts";
export { stripExif } from "./infrastructure/exif-strip.ts";

// --- Infrastructure: Nostr, Blossom, Verification ---
export * as nostr from "./infrastructure/nostr/index.ts";
export * as blossom from "./infrastructure/blossom/client.ts";
export { workerUpload } from "./infrastructure/blossom/worker-upload.ts";
export type { WorkerUploadResult } from "./infrastructure/blossom/worker-upload.ts";
export { fetchBlossomAttachment } from "./infrastructure/blossom/fetch-attachment.ts";
export * as verification from "./infrastructure/verification/index.ts";

// --- Infrastructure: Oracle Nostr service ---
export { createOracleNostrService, createOracleNostrServiceFromEnv } from "./infrastructure/oracle/oracle-nostr-service.ts";
export type { OracleNostrServiceConfig, OracleNostrService } from "./infrastructure/oracle/oracle-nostr-service.ts";

if (import.meta.main) {
  await import("./infrastructure/server.ts");
}
