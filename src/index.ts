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
  validateGpsCoord, validateBountyInfo, validateEscrowLocktime, validateQueryInput, validateQuoteInfo,
} from "./domain/value-objects.ts";
export type { EscrowInfo, EscrowType, QuoteInfo, VerificationRequirement, VerificationInput, VerificationDetail, VerificationFactor } from "./domain/types.ts";

export { createQueryService, createQueryStore } from "./application/query-service.ts";
export type {
  AttachmentRef, AttachmentStorageKind, CancelQueryOutcome, CreateQueryOptions,
  HtlcOutcome, Query, QueryHooks, QueryService, QueryServiceDeps, QueryStore,
  RequesterMeta, RequesterType, QueryExecutorType, QueryInput, QueryResult,
  QueryStatus, QuerySubmissionMeta, QueryVerification, SubmitQueryOutcome,
} from "./application/query-service.ts";
export { MIN_ESCROW_LOCKTIME_SECS } from "./application/query-escrow-validation.ts";
export { purgeExpiredQueries } from "./application/data-purge.ts";
export type { EscrowProvider } from "./application/escrow-port.ts";
export type { FrostSignaturePort } from "./application/frost-signature-port.ts";

export {
  discoverQueries, submitQuote, waitForSelection, encryptAndUpload,
  publishResult, waitForPreimage,
} from "./infrastructure/nostr/worker-service.ts";
export type { WorkerConfig, DiscoveredQuery, WorkerQueryState } from "./infrastructure/nostr/worker-service.ts";

export {
  requestOracleHash, createHtlcQuery, subscribeToQuotes, selectWorker,
} from "./infrastructure/nostr/requester-service.ts";
export type { RequesterConfig, CreateQueryRequest, RequesterQueryState } from "./infrastructure/nostr/requester-service.ts";

export { createCashuEscrowProvider } from "./infrastructure/cashu/cashu-escrow-provider.ts";
export { createFrostEscrowProvider } from "./infrastructure/frost/frost-escrow-provider.ts";

export type { PreimageStore, PreimageEntry } from "@anchr/core-cashu/preimage-port";
export { createPreimageStore, createPersistentPreimageStore } from "@anchr/core-cashu/preimage-store";

export type { OracleRegistry } from "./application/oracle-port.ts";
export { createOracleRegistry, listOracles, getOracle, registerOracle, resolveOracle, createHttpOracle, buildOracleApp } from "./infrastructure/oracle/index.ts";
export type { Oracle, OracleInfo, OracleAttestation, HttpOracleConfig } from "./infrastructure/oracle/index.ts";

export { startMcpServer as startMcpAdapter } from "./infrastructure/mcp-server.ts";
export { startReferenceRuntime } from "./infrastructure/runtime.ts";
export { verify as verifyQueryResult, verifyProof, queryToRequirement, queryResultToInput } from "./infrastructure/verification/verifier.ts";
export { stripExif } from "./infrastructure/exif-strip.ts";

export * as nostr from "./infrastructure/nostr/index.ts";
export * as blossom from "@anchr/blossom";
export { workerUpload } from "./infrastructure/blossom/worker-upload.ts";
export type { WorkerUploadResult } from "./infrastructure/blossom/worker-upload.ts";
export { fetchBlossomAttachment } from "./infrastructure/blossom/fetch-attachment.ts";
export * as verification from "./infrastructure/verification/index.ts";

export { createOracleNostrService, createOracleNostrServiceFromEnv } from "./infrastructure/oracle/nostr/oracle-nostr-service.ts";
export type { OracleNostrServiceConfig, OracleNostrService } from "./infrastructure/oracle/nostr/oracle-nostr-service.ts";

if (import.meta.main) {
  await import("./infrastructure/server.ts");
}
