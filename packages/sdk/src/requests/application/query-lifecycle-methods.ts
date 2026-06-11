import { createQueryAggregate } from "../domain/query-aggregate.ts";
import { isCancellable, isExpirable } from "../domain/query-transitions.ts";
import type { QueryStore } from "../domain/query-store.ts";
import type { BlossomKeyMap } from "../../values.ts";
import type {
  Query,
  QueryInput,
  QueryResult,
  SubmissionMeta,
} from "../domain/types.ts";
import type {
  CancelQueryOutcome,
  CreateQueryOptions,
  QueryHooks,
  SubmitQueryOutcome,
} from "./query-service.ts";
import {
  identityNormalize,
  resolveTtlMs,
  ServiceDeps,
} from "./query-service-deps.ts";
import { verifyAndFinalize } from "./verification-orchestration.ts";

export function doCreateQuery(
  deps: ServiceDeps,
  input: QueryInput,
  options: CreateQueryOptions | undefined,
  hooks: QueryHooks | undefined,
): Query {
  const result = createQueryAggregate(input, {
    ttlMs: resolveTtlMs(options),
    customerMeta: options?.customerMeta,
    payment_lock: options?.payment_lock,
    oracleIds: options?.oracleIds,
    escrow: options?.escrow,
    nostrEventId: options?.nostrEventId,
    quorum: options?.quorum,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  const query = result.query;
  deps.store.set(query.id, query);
  hooks?.onCreated?.(query);
  return query;
}

export async function doSubmitQueryResult(
  deps: ServiceDeps,
  id: string,
  result: QueryResult,
  submissionMeta: SubmissionMeta,
  oracleId?: string,
  blossomKeys?: BlossomKeyMap,
): Promise<SubmitQueryOutcome> {
  const { store } = deps;
  const query = store.get(id);
  if (!query) return { ok: false, query: null, message: "Query not found" };
  if (query.status !== "pending") {
    return {
      ok: false,
      query,
      message: `Query is ${query.status}, not pending`,
    };
  }
  if (query.expires_at < Date.now()) {
    store.set(id, { ...query, status: "expired", payment_status: "cancelled" });
    return { ok: false, query, message: "Query has expired" };
  }

  const normalizedResult = (deps.normalizeResult ?? identityNormalize)(result);
  const { passed, attestations, verification, updated } =
    await verifyAndFinalize(
      query,
      normalizedResult,
      deps,
      blossomKeys,
      oracleId,
    );

  if (!passed && attestations.length === 0) {
    return {
      ok: false,
      query,
      message: verification.failures[0] ?? "No oracle available",
    };
  }

  const final: Query = {
    ...updated,
    submitted_at: Date.now(),
    result: normalizedResult,
    submission_meta: submissionMeta,
    blossom_keys: blossomKeys,
  };
  store.set(id, final);

  return {
    ok: passed,
    query: final,
    message: passed
      ? "Verification passed. Result accepted."
      : `Verification failed: ${verification.failures.join(", ")}`,
  };
}

export function doCancelQuery(
  store: QueryStore,
  id: string,
): CancelQueryOutcome {
  const query = store.get(id);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isCancellable(query.status)) {
    return { ok: false, message: `Query is already ${query.status}` };
  }
  store.set(id, { ...query, status: "rejected", payment_status: "cancelled" });
  return { ok: true, message: "Query cancelled" };
}

export function doExpireQueries(store: QueryStore): number {
  const now = Date.now();
  let count = 0;
  for (const query of store.values()) {
    if (isExpirable(query.status) && query.expires_at < now) {
      store.set(query.id, {
        ...query,
        status: "expired",
        payment_status: "cancelled",
      });
      count++;
    }
  }
  return count;
}

export function doPurgeExpired(store: QueryStore): Query[] {
  const expired: Query[] = [];
  for (const query of store.values()) {
    if (query.status === "expired") {
      expired.push(query);
      store.delete(query.id);
    }
  }
  return expired;
}
