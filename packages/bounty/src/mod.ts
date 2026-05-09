export { queryTemplates } from "./domain/query-templates.ts";
export {
  addQuote,
  cancelQuery as cancelQueryAggregate,
  completeVerification,
  createQueryAggregate,
  expireQuery,
  recordResult,
  selectWorker as selectWorkerAggregate,
  submitResult,
} from "./domain/query-aggregate.ts";
export type {
  CreateQueryAggregateOptions,
  TransitionResult,
} from "./domain/query-aggregate.ts";
export {
  createInMemoryQueryRepository,
  toRepository,
} from "./domain/query-repository.ts";
export type { QueryRepository } from "./domain/query-repository.ts";
export {
  isCancellable,
  isExpirable,
  isTerminal,
  isValidTransition,
} from "./domain/query-transitions.ts";
export {
  validateBountyInfo,
  validateEscrowLocktime,
  validateGpsCoord,
  validateQueryInput,
  validateQuoteInfo,
} from "./domain/value-objects.ts";
export type {
  EscrowInfo,
  EscrowType,
  QuoteInfo,
  VerificationDetail,
  VerificationFactor,
  VerificationInput,
  VerificationRequirement,
} from "./domain/types.ts";

export {
  createQueryService,
  createQueryStore,
} from "./application/query-service.ts";
export type {
  AttachmentRef,
  AttachmentStorageKind,
  CancelQueryOutcome,
  CreateQueryOptions,
  HtlcOutcome,
  Query,
  QueryExecutorType,
  QueryHooks,
  QueryInput,
  QueryResult,
  QueryService,
  QueryServiceDeps,
  QueryStatus,
  QueryStore,
  QuerySubmissionMeta,
  QueryVerification,
  RequesterMeta,
  RequesterType,
  SubmitQueryOutcome,
} from "./application/query-service.ts";
export { MIN_ESCROW_LOCKTIME_SECS } from "./application/query-escrow-validation.ts";
export { purgeExpiredQueries } from "./application/data-purge.ts";
export type {
  EscrowProvider,
  FrostSignaturePort,
} from "./application/ports.ts";

export {
  discoverQueries,
  encryptAndUpload,
  publishResult,
  submitQuote,
  waitForPreimage,
  waitForSelection,
} from "./infrastructure/nostr/worker-service.ts";
export type {
  DiscoveredQuery,
  WorkerConfig,
  WorkerQueryState,
} from "./infrastructure/nostr/worker-service.ts";

export {
  createHtlcQuery,
  requestOracleHash,
  selectWorker,
  subscribeToQuotes,
} from "./infrastructure/nostr/requester-service.ts";
export type {
  CreateQueryRequest,
  RequesterConfig,
  RequesterQueryState,
} from "./infrastructure/nostr/requester-service.ts";

export { createCashuEscrowProvider } from "./infrastructure/escrow/cashu-htlc.ts";
export { createFrostEscrowProvider } from "./infrastructure/escrow/frost-p2pk.ts";

export type {
  PreimageEntry,
  PreimageStore,
} from "@anchr/core-cashu/preimage-port";
export {
  createPersistentPreimageStore,
  createPreimageStore,
} from "@anchr/core-cashu/preimage-store";

export type { OracleRegistry } from "./application/ports.ts";
export {
  createHttpOracle,
  createOracleRegistry,
  getOracle,
  listOracles,
  registerOracle,
  resolveOracle,
} from "./infrastructure/oracle-client/index.ts";
export type {
  HttpOracleConfig,
  Oracle,
  OracleAttestation,
  OracleInfo,
} from "./infrastructure/oracle-client/index.ts";
export { buildOracleApp } from "./infrastructure/oracle-service/index.ts";

export { startMcpServer as startMcpAdapter } from "./infrastructure/mcp-server.ts";
export {
  composeHost,
  startReferenceRuntime,
} from "./infrastructure/runtime.ts";
export type {
  ComposeHostOptions,
  HostComposition,
} from "./infrastructure/runtime.ts";
export {
  queryResultToInput,
  queryToRequirement,
  verify as verifyQueryResult,
  verifyProof,
} from "./infrastructure/verification/verifier.ts";
export { stripExif } from "./infrastructure/exif-strip.ts";

export * as nostr from "./infrastructure/nostr/index.ts";
export * as blossom from "@anchr/blossom";
export { workerUpload } from "./infrastructure/blossom/worker-upload.ts";
export type { WorkerUploadResult } from "./infrastructure/blossom/worker-upload.ts";
export { fetchBlossomAttachment } from "./infrastructure/blossom/fetch-attachment.ts";
export * as verification from "./infrastructure/verification/index.ts";
export * as claimGate from "./infrastructure/claim-gate/index.ts";

export {
  createOracleNostrService,
  createOracleNostrServiceFromEnv,
} from "./infrastructure/oracle-service/nostr-service.ts";
export type {
  OracleNostrService,
  OracleNostrServiceConfig,
} from "./infrastructure/oracle-service/nostr-service.ts";

if (import.meta.main) {
  await import("./infrastructure/server.ts");
}
