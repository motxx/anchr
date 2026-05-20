export { queryTemplates } from "./domain/query-templates.ts";
export {
  addOffer,
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
  validateOfferInfo,
  validateQueryInput,
} from "./domain/value-objects.ts";
export {
  DEFAULT_VERIFICATION_FACTORS,
  VERIFICATION_FACTORS,
} from "./domain/types.ts";
export type {
  AttachmentHandle,
  EscrowInfo,
  EscrowType,
  OfferInfo,
  TlsnAttestation,
  TlsnRequirement,
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
  OracleRegistry,
} from "./application/ports.ts";
