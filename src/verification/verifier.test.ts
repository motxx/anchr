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
    verification_requirements: ["nonce", "gps", "ai_check"],
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
    payment_status: "locked",
    ...overrides,
  };
}

test("rejects empty submission when GPS/nonce required", async () => {
  const query = makeQuery({});
  const result: QueryResult = {
    attachments: [],
    notes: "",
  };

  const verification = await verify(query, result);

  // Fix 1: Empty attachments with GPS/nonce requirements → rejection
  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain("no media evidence provided — photos are required when GPS or nonce verification is enabled");
});

test("empty submission passes weak verification when no evidence required", async () => {
  const query = makeQuery({ verification_requirements: ["ai_check"], bounty: undefined, expected_gps: undefined });
  const result: QueryResult = {
    attachments: [],
    notes: "text only",
  };

  const verification = await verify(query, result);

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

test("bounty query without GPS/nonce requirements allows empty submission", async () => {
  const query = makeQuery({ bounty: { amount_sats: 100 }, verification_requirements: [] });
  const result: QueryResult = {
    attachments: [],
    notes: "Observed the target",
  };

  const verification = await verify(query, result);

  // Bounty alone doesn't require evidence — verification_requirements control evidence needs
  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain("no media evidence provided (weak verification)");
});

test("bounty query with GPS requirement rejects empty submission", async () => {
  const query = makeQuery({ bounty: { amount_sats: 100 }, verification_requirements: ["gps"] });
  const result: QueryResult = {
    attachments: [],
    notes: "Observed the target",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain("no media evidence provided — photos are required when GPS or nonce verification is enabled");
});

test("body GPS within range passes", async () => {
  const query = makeQuery({
    expected_gps: { lat: 35.6762, lon: 139.6503 },
    verification_requirements: ["gps"],
  });
  const result: QueryResult = {
    attachments: [],
    notes: "nearby",
    gps: { lat: 35.68, lon: 139.65 },
  };

  const verification = await verify(query, result);

  // Still fails because no attachments + GPS required, but body GPS check itself passes
  expect(verification.checks.some((c) => c.includes("body GPS within"))).toBe(true);
});

test("body GPS too far fails", async () => {
  const query = makeQuery({
    expected_gps: { lat: 35.6762, lon: 139.6503 },
    verification_requirements: ["gps"],
  });
  const result: QueryResult = {
    attachments: [],
    notes: "far away",
    gps: { lat: 40.0, lon: 140.0 },
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures.some((f) => f.includes("body GPS") && f.includes("from expected location"))).toBe(true);
});

test("missing body GPS fails when GPS verification required", async () => {
  const query = makeQuery({
    expected_gps: { lat: 35.6762, lon: 139.6503 },
    verification_requirements: ["gps"],
  });
  const result: QueryResult = {
    attachments: [],
    notes: "no gps",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain("GPS coordinates missing from submission body — required by verification policy");
});
