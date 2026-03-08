export {
  cancelQuery,
  createQuery,
  createQueryService,
  expireQueries,
  getDefaultQueryService,
  getQuery,
  listOpenQueries,
  queryTemplates,
  submitQueryResult,
} from "./query-service";
export type {
  AttachmentRef,
  AttachmentStorageKind,
  CancelQueryOutcome,
  CreateQueryOptions,
  Query,
  QueryService,
  QueryStore,
  QueryExecutorType,
  QueryInput,
  QueryResult,
  QueryStatus,
  QuerySubmissionMeta,
  QueryType,
  QueryVerification,
  SubmitQueryOutcome,
} from "./query-service";
export { startMcpServer as startMcpAdapter } from "./mcp-server";
export { startWorkerApi as startReferenceWorkerApi } from "./worker-api";
export { verify as verifyQueryResult } from "./verification";

if (import.meta.main) {
  await import("./server");
}
