import { beforeEach, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createQueryService } from "./query-service";
import type { QueryService } from "./query-service";
import { createOracleRegistry } from "../infrastructure/oracle/registry";
import { normalizeQueryResult } from "../infrastructure/attachments";
import { storeIntegrity, clearIntegrityStore } from "../infrastructure/verification/integrity-store";

let svc: QueryService;

beforeEach(() => {
  svc = createQueryService({
    oracleRegistry: createOracleRegistry(),
    normalizeResult: normalizeQueryResult,
  });
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

test("query service approves valid submissions", async () => {
  const query = svc.createQuery({
    description: "Check if Test Ramen is open",
    location_hint: "Tokyo",
    verification_requirements: [],
  });

  const outcome = await svc.submitQueryResult(query.id, {
    attachments: [],
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
  const expired = svc.createQuery({
    description: "Expired query",
  }, {
    ttlMs: -1,
  });
  const active = svc.createQuery({
    description: "Active query",
  }, {
    ttlMs: 60_000,
  });

  const openIds = svc.listOpenQueries().map((query) => query.id);

  expect(openIds).toContain(active.id);
  expect(openIds).not.toContain(expired.id);
});

test("query service cancels pending queries", () => {
  const query = svc.createQuery({
    description: "Query to cancel",
  });

  const outcome = svc.cancelQuery(query.id);

  expect(outcome).toEqual({
    ok: true,
    message: "Query cancelled",
  });
  expect(svc.getQuery(query.id)?.status).toBe("rejected");
});

test("query service stores oracle_ids from options", () => {
  const query = svc.createQuery(
    { description: "Test query" },
    { oracleIds: ["oracle-a", "oracle-b"] },
  );

  expect(query.oracle_ids).toEqual(["oracle-a", "oracle-b"]);
});

test("query service records assigned_oracle_id on submission", async () => {
  const query = svc.createQuery({
    description: "Test Ramen status",
    verification_requirements: [],
  });

  const outcome = await svc.submitQueryResult(
    query.id,
    { attachments: [], notes: "open" },
    { executor_type: "human", channel: "worker_api" },
  );

  expect(outcome.ok).toBe(true);
  expect(outcome.query?.assigned_oracle_id).toBe("built-in");
});

test("query service rejects submission with unacceptable oracle", async () => {
  const query = svc.createQuery(
    { description: "Test query" },
    { oracleIds: ["oracle-x"] },
  );

  const outcome = await svc.submitQueryResult(
    query.id,
    { attachments: [], notes: "open" },
    { executor_type: "human", channel: "worker_api" },
    "built-in", // not in oracle_ids
  );

  expect(outcome.ok).toBe(false);
  expect(outcome.message).toContain("not available or not accepted");
});

test("query service normalizes blossom attachment refs before approval", async () => {
  const query = svc.createQuery({
    description: "Storefront observation",
  });

  injectValidC2pa("abc123", query.id);
  const outcome = await svc.submitQueryResult(query.id, {
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
  expect(outcome.query?.result?.attachments[0]?.storage_kind).toBe("blossom");
  expect(outcome.query?.result?.attachments[0]?.blossom_hash).toBe("abc123");
});
