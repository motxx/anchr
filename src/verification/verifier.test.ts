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
    type: "photo_proof",
    status: "pending",
    params: { type: "photo_proof", target: "storefront" },
    challenge_nonce: "K7P4",
    challenge_rule: "include nonce",
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
    payment_status: "locked",
    ...overrides,
  };
}

test("photo_proof requires at least one attachment", async () => {
  const query = makeQuery({});
  const result: QueryResult = {
    type: "photo_proof",
    text_answer: "Saw the storefront K7P4",
    attachments: [],
    notes: "",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain("at least one photo attachment is required");
});

test("webpage_field requires anchor_word in proof_text", async () => {
  const query = makeQuery({
    type: "webpage_field",
    params: {
      type: "webpage_field",
      url: "https://example.com",
      field: "price",
      anchor_word: "税込",
    },
  });
  const result: QueryResult = {
    type: "webpage_field",
    answer: "¥980",
    proof_text: "some text without the anchor word",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain('anchor word "税込" not found in proof_text');
});

test("webpage_field passes when proof text contains anchor word", async () => {
  const query = makeQuery({
    type: "webpage_field",
    params: {
      type: "webpage_field",
      url: "https://example.com",
      field: "price",
      anchor_word: "税込",
    },
  });
  const result: QueryResult = {
    type: "webpage_field",
    answer: "¥980",
    proof_text: "通常価格 税込 ¥980",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.failures).toHaveLength(0);
});

test("store_status with photo evidence passes (C2PA valid)", async () => {
  const query = makeQuery({
    type: "store_status",
    params: { type: "store_status", store_name: "Test Ramen" },
  });
  const result: QueryResult = {
    type: "store_status",
    status: "open",
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
  expect(verification.checks).toContain("photo attachment present");
  expect(verification.checks).toContain("C2PA: valid Content Credentials signature");
});

test("store_status with photo but no C2PA fails", async () => {
  const query = makeQuery({
    type: "store_status",
    params: { type: "store_status", store_name: "Test Ramen" },
  });
  const result: QueryResult = {
    type: "store_status",
    status: "open",
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

test("store_status without photo evidence passes with weak verification", async () => {
  const query = makeQuery({
    type: "store_status",
    params: { type: "store_status", store_name: "Test Ramen" },
  });
  const result: QueryResult = {
    type: "store_status",
    status: "open",
    notes: "Store looked open",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain("no photo evidence provided (weak verification)");
});
