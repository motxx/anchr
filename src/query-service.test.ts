import { expect, test, beforeEach } from "bun:test";
import {
  clearQueryStore,
  createQuery,
  getQuery,
  listOpenQueries,
  cancelQuery,
  submitQueryResult,
} from "./query-service";
import { storeIntegrity, clearIntegrityStore } from "./verification/integrity-store";

beforeEach(() => {
  clearQueryStore();
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

test("query service approves valid store status submissions", async () => {
  const query = createQuery({
    type: "store_status",
    store_name: "Test Ramen",
    location_hint: "Tokyo",
  });

  const outcome = await submitQueryResult(query.id, {
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
  const expired = createQuery({
    type: "photo_proof",
    target: "Storefront",
  }, {
    ttlMs: -1,
  });
  const active = createQuery({
    type: "photo_proof",
    target: "Signboard",
  }, {
    ttlMs: 60_000,
  });

  const openIds = listOpenQueries().map((query) => query.id);

  expect(openIds).toContain(active.id);
  expect(openIds).not.toContain(expired.id);
});

test("query service cancels pending queries", () => {
  const query = createQuery({
    type: "webpage_field",
    url: "https://example.com",
    field: "price",
    anchor_word: "税込",
  });

  const outcome = cancelQuery(query.id);

  expect(outcome).toEqual({
    ok: true,
    message: "Query cancelled",
  });
  expect(getQuery(query.id)?.status).toBe("rejected");
});

test("query service stores oracle_ids from options", () => {
  const query = createQuery(
    { type: "store_status", store_name: "Test" },
    { oracleIds: ["oracle-a", "oracle-b"] },
  );

  expect(query.oracle_ids).toEqual(["oracle-a", "oracle-b"]);
});

test("query service records assigned_oracle_id on submission", async () => {
  const query = createQuery({
    type: "store_status",
    store_name: "Test Ramen",
  });

  const outcome = await submitQueryResult(
    query.id,
    { type: "store_status", status: "open" },
    { executor_type: "human", channel: "worker_api" },
  );

  expect(outcome.ok).toBe(true);
  expect(outcome.query?.assigned_oracle_id).toBe("built-in");
});

test("query service rejects submission with unacceptable oracle", async () => {
  const query = createQuery(
    { type: "store_status", store_name: "Test" },
    { oracleIds: ["oracle-x"] },
  );

  const outcome = await submitQueryResult(
    query.id,
    { type: "store_status", status: "open" },
    { executor_type: "human", channel: "worker_api" },
    "built-in", // not in oracle_ids
  );

  expect(outcome.ok).toBe(false);
  expect(outcome.message).toContain("not available or not accepted");
});

test("query service normalizes blossom attachment refs before approval", async () => {
  const query = createQuery({
    type: "photo_proof",
    target: "Storefront",
  });

  injectValidC2pa("abc123", query.id);
  const outcome = await submitQueryResult(query.id, {
    type: "photo_proof",
    text_answer: `Observed storefront ${query.challenge_nonce}`,
    attachments: [{
      id: "abc123",
      uri: "https://blossom.example.com/abc123",
      mime_type: "image/png",
      storage_kind: "blossom",
      blossom_hash: "abc123",
      blossom_servers: ["https://blossom.example.com"],
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
  expect(outcome.query.result.attachments[0]?.storage_kind).toBe("blossom");
  expect(outcome.query.result.attachments[0]?.blossom_hash).toBe("abc123");
});
