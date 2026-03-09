/**
 * Submission pipeline: verify → settle.
 *
 * Validates query state, normalizes the result,
 * runs verification, and updates the query record.
 */

import { normalizeQueryResult } from "../attachments";
import type {
  Query,
  QueryResult,
  SubmissionMeta,
} from "../types";
import { verify } from "../verification/verifier";
import type { QueryStore, SubmitQueryOutcome } from "../query-service";

export async function runSubmissionPipeline(
  store: QueryStore,
  id: string,
  result: QueryResult,
  submissionMeta: SubmissionMeta,
): Promise<SubmitQueryOutcome> {
  const query = store.getQuery(id);
  if (!query) return { ok: false, query: null, message: "Query not found" };
  if (query.status !== "pending") return { ok: false, query, message: `Query is ${query.status}, not pending` };
  if (query.expires_at < Date.now()) {
    store.updateQueryStatus(id, "expired", "cancelled");
    return { ok: false, query, message: "Query has expired" };
  }

  const normalizedResult = normalizeQueryResult(result);
  const verification = await verify(query, normalizedResult);

  if (verification.passed) {
    store.updateQuerySubmitted(id, normalizedResult, verification, "approved", "released", submissionMeta);
    const updated = store.getQuery(id)!;
    return { ok: true, query: updated, message: "Verification passed. Result accepted." };
  }

  store.updateQuerySubmitted(id, normalizedResult, verification, "rejected", "cancelled", submissionMeta);
  const updated = store.getQuery(id)!;
  return {
    ok: false,
    query: updated,
    message: `Verification failed: ${verification.failures.join(", ")}`,
  };
}
