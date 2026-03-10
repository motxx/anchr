import { expect, test, beforeEach } from "bun:test";
import {
  createQueryService,
  type Query,
  type QueryResult,
  type QueryService,
  type QueryStatus,
  type QueryStore,
} from "./query-service";
import type { PaymentStatus, SubmissionMeta, VerificationDetail } from "./types";
import { storeIntegrity, clearIntegrityStore } from "./verification/integrity-store";

beforeEach(() => {
  clearIntegrityStore();
});

function injectValidC2pa(attachmentId: string, queryId: string) {
  storeIntegrity({
    attachmentId,
    queryId,
    capturedAt: Date.now(),
    exif: { hasExif: false, hasCameraModel: false, hasGps: false, hasTimestamp: false, timestampRecent: false, gpsNearHint: null, metadata: {}, checks: [], failures: [] },
    c2pa: { available: true, hasManifest: true, signatureValid: true, manifest: { title: "test.jpg" }, checks: ["C2PA manifest found", "C2PA signature valid"], failures: [] },
  });
}

function createInMemoryQueryService(): QueryService {
  const queries = new Map<string, Query>();

  const store: QueryStore = {
    insertQuery(query) {
      queries.set(query.id, structuredClone(query));
    },
    getQuery(id) {
      const query = queries.get(id);
      return query ? structuredClone(query) : null;
    },
    listQueries(status?: QueryStatus) {
      return [...queries.values()]
        .filter((query) => (status ? query.status === status : true))
        .map((query) => structuredClone(query));
    },
    updateQuerySubmitted(
      id: string,
      result: QueryResult,
      verification: VerificationDetail,
      newStatus: QueryStatus,
      paymentStatus: PaymentStatus,
      submissionMeta: SubmissionMeta,
      assignedOracleId?: string,
    ) {
      const query = queries.get(id);
      if (!query) return;
      queries.set(id, {
        ...query,
        status: newStatus,
        submitted_at: Date.now(),
        result: structuredClone(result),
        verification: structuredClone(verification),
        submission_meta: structuredClone(submissionMeta),
        payment_status: paymentStatus,
        assigned_oracle_id: assignedOracleId,
      });
    },
    updateQueryStatus(id, status, paymentStatus) {
      const query = queries.get(id);
      if (!query) return;
      queries.set(id, {
        ...query,
        status,
        payment_status: paymentStatus ?? query.payment_status,
      });
    },
    expirePendingQueries() {
      let expired = 0;
      for (const [id, query] of queries.entries()) {
        if (query.status === "pending" && query.expires_at < Date.now()) {
          queries.set(id, {
            ...query,
            status: "expired",
            payment_status: "cancelled",
          });
          expired += 1;
        }
      }
      return expired;
    },
  };

  return createQueryService(store);
}

test("query service approves valid store status submissions", async () => {
  const service = createInMemoryQueryService();
  const query = service.createQuery({
    type: "store_status",
    store_name: "Test Ramen",
    location_hint: "Tokyo",
  });

  const outcome = await service.submitQueryResult(query.id, {
    type: "store_status",
    status: "open",
    notes: "Observed storefront, looked open",
  }, {
    executor_type: "human",
    channel: "worker_api",
  });

  expect(outcome.ok).toBe(true);
  expect(outcome.query?.status).toBe("approved");
  expect(outcome.query?.submission_meta).toEqual({
    executor_type: "human",
    channel: "worker_api",
  });
});

test("query service excludes expired pending queries from open list", () => {
  const service = createInMemoryQueryService();
  const expired = service.createQuery({
    type: "photo_proof",
    target: "Storefront",
  }, {
    ttlMs: -1,
  });
  const active = service.createQuery({
    type: "photo_proof",
    target: "Signboard",
  }, {
    ttlMs: 60_000,
  });

  const openIds = service.listOpenQueries().map((query) => query.id);

  expect(openIds).toContain(active.id);
  expect(openIds).not.toContain(expired.id);
});

test("query service cancels pending queries", () => {
  const service = createInMemoryQueryService();
  const query = service.createQuery({
    type: "webpage_field",
    url: "https://example.com",
    field: "price",
    anchor_word: "税込",
  });

  const outcome = service.cancelQuery(query.id);

  expect(outcome).toEqual({
    ok: true,
    message: "Query cancelled",
  });
  expect(service.getQuery(query.id)?.status).toBe("rejected");
});

test("query service stores oracle_ids from options", () => {
  const service = createInMemoryQueryService();
  const query = service.createQuery(
    { type: "store_status", store_name: "Test" },
    { oracleIds: ["oracle-a", "oracle-b"] },
  );

  expect(query.oracle_ids).toEqual(["oracle-a", "oracle-b"]);
});

test("query service records assigned_oracle_id on submission", async () => {
  const service = createInMemoryQueryService();
  const query = service.createQuery({
    type: "store_status",
    store_name: "Test Ramen",
  });

  const outcome = await service.submitQueryResult(
    query.id,
    { type: "store_status", status: "open" },
    { executor_type: "human", channel: "worker_api" },
  );

  expect(outcome.ok).toBe(true);
  expect(outcome.query?.assigned_oracle_id).toBe("built-in");
});

test("query service rejects submission with unacceptable oracle", async () => {
  const service = createInMemoryQueryService();
  const query = service.createQuery(
    { type: "store_status", store_name: "Test" },
    { oracleIds: ["oracle-x"] },
  );

  const outcome = await service.submitQueryResult(
    query.id,
    { type: "store_status", status: "open" },
    { executor_type: "human", channel: "worker_api" },
    "built-in", // not in oracle_ids
  );

  expect(outcome.ok).toBe(false);
  expect(outcome.message).toContain("not available or not accepted");
});

test("query service materializes local attachment refs before approval", async () => {
  const service = createInMemoryQueryService();
  const query = service.createQuery({
    type: "photo_proof",
    target: "Storefront",
  });

  injectValidC2pa("example.png", query.id);
  const outcome = await service.submitQueryResult(query.id, {
    type: "photo_proof",
    text_answer: `Observed storefront ${query.challenge_nonce}`,
    attachments: [{
      id: "example.png",
      uri: "/uploads/example.png",
      mime_type: "image/png",
      storage_kind: "local",
      route_path: "/uploads/example.png",
    }],
    notes: "ok",
  }, {
    executor_type: "human",
    channel: "worker_api",
  });

  expect(outcome.ok).toBe(true);
  expect(outcome.query?.result?.type).toBe("photo_proof");
  if (outcome.query?.result?.type !== "photo_proof") {
    throw new Error("expected photo_proof result");
  }
  expect(outcome.query.result.attachments[0]).toEqual({
    id: "example.png",
    uri: "/uploads/example.png",
    mime_type: "image/png",
    storage_kind: "local",
    filename: "example.png",
    size_bytes: undefined,
    local_file_path: expect.any(String),
    route_path: "/uploads/example.png",
  });
});
