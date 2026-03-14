import { expect, test, beforeEach } from "bun:test";
import { verify } from "./verifier";
import { storeIntegrity, clearIntegrityStore } from "./integrity-store";
import type { Query, QueryResult } from "../types";

beforeEach(() => {
  clearIntegrityStore();
});

/** Inject a valid C2PA integrity record for a given attachment + query. */
function injectC2paIntegrity(attachmentId: string, queryId: string) {
  storeIntegrity({
    attachmentId,
    queryId,
    capturedAt: Date.now(),
    exif: {
      hasExif: false,
      hasCameraModel: false,
      hasGps: false,
      hasTimestamp: false,
      timestampRecent: false,
      gpsNearHint: null,
      metadata: {},
      checks: [],
      failures: [],
    },
    c2pa: {
      available: true,
      hasManifest: true,
      signatureValid: true,
      manifest: { title: "test.jpg", claimGenerator: "test" },
      checks: ["C2PA manifest found", "C2PA signature valid"],
      failures: [],
    },
  });
}

function makeQuery(overrides: Partial<Query>): Query {
  return {
    id: "query_test",
    status: "pending",
    description: "Test query",
    challenge_nonce: "K7P4",
    challenge_rule: "include nonce",
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
    payment_status: "locked",
    ...overrides,
  };
}

test("requires at least one attachment for strong verification", async () => {
  const query = makeQuery({});
  const result: QueryResult = {
    attachments: [],
    notes: "",
  };

  const verification = await verify(query, result);

  // Empty attachments → weak verification pass (advisory only)
  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain("no media evidence provided (weak verification)");
});

test("attachment with valid C2PA passes", async () => {
  const query = makeQuery({});
  const result: QueryResult = {
    attachments: [{
      id: "photo1",
      uri: "https://blossom.example.com/photo1",
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      blossom_hash: "photo1",
    }],
  };

  injectC2paIntegrity("photo1", query.id);
  const verification = await verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain("attachment present");
  expect(verification.checks).toContain("C2PA: valid Content Credentials signature");
});

test("attachment without C2PA fails", async () => {
  const query = makeQuery({});
  const result: QueryResult = {
    attachments: [{
      id: "photo_no_c2pa",
      uri: "https://blossom.example.com/photo_no_c2pa",
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      blossom_hash: "photo_no_c2pa",
    }],
  };

  // Inject integrity record with NO C2PA manifest
  storeIntegrity({
    attachmentId: "photo_no_c2pa",
    queryId: query.id,
    capturedAt: Date.now(),
    exif: { hasExif: false, hasCameraModel: false, hasGps: false, hasTimestamp: false, timestampRecent: false, gpsNearHint: null, metadata: {}, checks: [], failures: [] },
    c2pa: { available: true, hasManifest: false, signatureValid: false, manifest: null, checks: [], failures: [] },
  });
  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain("C2PA: no Content Credentials found — use a C2PA-enabled camera");
});

test("no attachments passes with weak verification", async () => {
  const query = makeQuery({});
  const result: QueryResult = {
    attachments: [],
    notes: "Observed the target",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain("no media evidence provided (weak verification)");
});
