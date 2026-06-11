import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { verify } from "./verifier.ts";
import { clearIntegrityStore, storeIntegrity } from "../mod.ts";
import type {
  Query,
  QueryResult,
  TlsnAttestation,
  TlsnRequirement,
} from "../../requests/domain/types.ts";
import type { TlsnValidationResult } from "../mod.ts";
import { makeQuery as makeBaseQuery } from "../../testing/factories.ts";

function makeQuery(overrides: Partial<Query>): Query {
  return makeBaseQuery({
    id: "query_test",
    challenge_nonce: "K7P4",
    challenge_rule: "include nonce",
    verification_requirements: ["nonce", "gps", "ai_check"],
    expires_at: Date.now() + 60_000,
    ...overrides,
  });
}

beforeEach(() => {
  clearIntegrityStore();
});

function injectC2paIntegrity(attachmentId: string, queryId: string) {
  storeIntegrity({
    attachmentId,
    requestId: queryId,
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

test("rejects empty submission when GPS/nonce required", async () => {
  const query = makeQuery({});
  const result: QueryResult = {
    attachments: [],
    notes: "",
  };

  const verification = await verify(query, result);

  // Fix 1: Empty attachments with GPS/nonce requirements → rejection
  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "no media evidence provided — photos are required when photo-backed verification is enabled",
  );
});

test("empty submission passes weak verification when no evidence required", async () => {
  const query = makeQuery({
    verification_requirements: ["ai_check"],
    payment_lock: undefined,
    expected_gps: undefined,
  });
  const result: QueryResult = {
    attachments: [],
    notes: "text only",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain(
    "no media evidence provided (weak verification)",
  );
});

test("empty submission fails when C2PA verification is required", async () => {
  const query = makeQuery({
    verification_requirements: ["c2pa"],
    expected_gps: undefined,
  });
  const result: QueryResult = {
    attachments: [],
    notes: "no photo",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "no media evidence provided — photos are required when photo-backed verification is enabled",
  );
});

test("c2pa required but only a non-image attachment fails closed", async () => {
  const query = makeQuery({
    verification_requirements: ["c2pa"],
    expected_gps: undefined,
  });
  const result: QueryResult = {
    attachments: [{
      id: "notes1",
      uri: "https://blossom.example.com/notes1",
      mime_type: "text/plain",
      storage_kind: "blossom",
      blossom_hash: "notes1",
    }],
    notes: "text instead of a photo",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "C2PA: required Content Credentials evidence missing — no image submitted",
  );
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
  expect(verification.checks).toContain(
    "C2PA: valid Content Credentials signature",
  );
});

test("INV-06: attachment with expected GPS requires C2PA-signed GPS binding", async () => {
  const query = makeQuery({
    expected_gps: { lat: 35.6762, lon: 139.6503 },
    verification_requirements: ["gps"],
  });
  const result: QueryResult = {
    attachments: [{
      id: "photo1",
      uri: "https://blossom.example.com/photo1",
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      blossom_hash: "photo1",
    }],
    gps: { lat: 35.6762, lon: 139.6503 },
  };

  injectC2paIntegrity("photo1", query.id);
  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "C2PA: signed GPS assertion missing from verified manifest",
  );
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
    requestId: query.id,
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
      hasManifest: false,
      signatureValid: false,
      manifest: null,
      checks: [],
      failures: [],
    },
  });
  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "C2PA: no Content Credentials found — use a C2PA-enabled camera",
  );
});

test("payment_lock query without GPS/nonce requirements allows empty submission", async () => {
  const query = makeQuery({
    payment_lock: { amount_sats: 100 },
    verification_requirements: [],
  });
  const result: QueryResult = {
    attachments: [],
    notes: "Observed the target",
  };

  const verification = await verify(query, result);

  // PaymentLock alone doesn't require evidence — verification_requirements control evidence needs
  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain(
    "no media evidence provided (weak verification)",
  );
});

test("payment_lock query with GPS requirement rejects empty submission", async () => {
  const query = makeQuery({
    payment_lock: { amount_sats: 100 },
    verification_requirements: ["gps"],
  });
  const result: QueryResult = {
    attachments: [],
    notes: "Observed the target",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "no media evidence provided — photos are required when photo-backed verification is enabled",
  );
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
  expect(verification.checks.some((c) => c.includes("body GPS within"))).toBe(
    true,
  );
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
  expect(
    verification.failures.some((f) =>
      f.includes("body GPS") && f.includes("from expected location")
    ),
  ).toBe(true);
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
  expect(verification.failures).toContain(
    "GPS coordinates missing from submission body — required by verification policy",
  );
});

// --- TLSNotary extension result path ---

function makeTlsnQuery(overrides: Partial<Query> = {}): Query {
  return {
    id: "query_tlsn",
    status: "pending",
    description: "TLSNotary test",
    verification_requirements: ["tlsn"],
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
    payment_status: "locked",
    tlsn_requirements: {
      target_url: "https://httpbin.org/get",
      conditions: [{
        type: "contains",
        expression: "httpbin",
        description: "contains httpbin",
      }],
    },
    ...overrides,
  };
}

const now = Math.floor(Date.now() / 1000);

function mockValidateTlsnSuccess() {
  return async (
    _att: TlsnAttestation,
    _req: TlsnRequirement,
  ): Promise<TlsnValidationResult> => ({
    available: true,
    signatureValid: true,
    serverIdentityValid: true,
    conditionResults: [{
      condition: { type: "contains", expression: "httpbin" },
      passed: true,
      actual_value: "httpbin",
    }],
    attestationFresh: true,
    verifiedData: {
      server_name: "httpbin.org",
      revealed_body: '{"ok":true,"url":"https://httpbin.org/get"}',
      session_timestamp: now,
    },
    checks: [
      "TLSNotary: presentation signature valid (cryptographically verified)",
      "TLSNotary: server name matches target (httpbin.org)",
      "TLSNotary condition passed: contains httpbin",
    ],
    failures: [],
  });
}

function mockValidateTlsnFailure() {
  return async (
    _att: TlsnAttestation,
    _req: TlsnRequirement,
  ): Promise<TlsnValidationResult> => ({
    available: true,
    signatureValid: false,
    serverIdentityValid: false,
    conditionResults: [],
    attestationFresh: false,
    verifiedData: undefined,
    checks: [],
    failures: [
      "TLSNotary: presentation signature invalid — verification failed",
    ],
  });
}

describe("verify() TLSNotary extension result path", () => {
  beforeEach(() => {
    clearIntegrityStore();
  });

  test("extension result + presentation → validateTlsn is called and verifies", async () => {
    const query = makeTlsnQuery();
    const result: QueryResult = {
      attachments: [],
      tlsn_extension_result: { presentation: "dGVzdA==" },
    };

    const verification = await verify(query, result, {
      validateTlsn: mockValidateTlsnSuccess(),
    });

    expect(verification.passed).toBe(true);
    expect(
      verification.checks.some((c) => c.includes("cryptographically verified")),
    ).toBe(true);
    expect(verification.checks.some((c) => c.includes("server name matches")))
      .toBe(true);
  });

  test("extension result + presentation + verification pass → tlsn_verified data is returned", async () => {
    const query = makeTlsnQuery();
    const result: QueryResult = {
      attachments: [],
      tlsn_extension_result: { presentation: "dGVzdA==" },
    };

    const verification = await verify(query, result, {
      validateTlsn: mockValidateTlsnSuccess(),
    });

    expect(verification.tlsn_verified).toBeDefined();
    expect(verification.tlsn_verified!.server_name).toBe("httpbin.org");
    expect(verification.tlsn_verified!.revealed_body).toContain("httpbin");
    expect(verification.tlsn_verified!.session_timestamp).toBe(now);
  });

  test("extension result + presentation + verification failure → failures populated", async () => {
    const query = makeTlsnQuery();
    const result: QueryResult = {
      attachments: [],
      tlsn_extension_result: { presentation: "dGVzdA==" },
    };

    const verification = await verify(query, result, {
      validateTlsn: mockValidateTlsnFailure(),
    });

    expect(verification.passed).toBe(false);
    expect(verification.failures.some((f) => f.includes("signature invalid")))
      .toBe(true);
    expect(verification.tlsn_verified).toBeUndefined();
  });

  test("extension result WITHOUT presentation → rejected (self-reported data not trusted)", async () => {
    const query = makeTlsnQuery();
    const result: QueryResult = {
      attachments: [],
      tlsn_extension_result: {
        results: [{ type: "text", part: "body", value: "fake data" }],
      },
    };

    // The injected validator should NOT be called for self-reported data.
    const verification = await verify(query, result, {
      validateTlsn: mockValidateTlsnSuccess(),
    });

    expect(verification.passed).toBe(false);
    expect(verification.failures).toContain(
      "TLSNotary extension: no cryptographic presentation included — self-reported data cannot be trusted",
    );
  });

  test("extension result + presentation BUT no tlsn_requirements → rejected", async () => {
    const query = makeTlsnQuery({ tlsn_requirements: undefined });
    const result: QueryResult = {
      attachments: [],
      tlsn_extension_result: { presentation: "dGVzdA==" },
    };

    // The injected validator should NOT be called without tlsn_requirements.
    const verification = await verify(query, result, {
      validateTlsn: mockValidateTlsnSuccess(),
    });

    expect(verification.passed).toBe(false);
    expect(verification.failures).toContain(
      "TLSNotary extension: query missing tlsn_requirements",
    );
  });

  test("extension result and CLI attestation both present → extension path takes priority", async () => {
    const query = makeTlsnQuery();
    const result: QueryResult = {
      attachments: [],
      tlsn_extension_result: { presentation: "ZXh0ZW5zaW9u" },
      tlsn_attestation: { presentation: "Y2xp" },
    };

    let calledWith: string | undefined;
    const verification = await verify(query, result, {
      validateTlsn: async (att, req) => {
        calledWith = att.presentation;
        return mockValidateTlsnSuccess()(att, req);
      },
    });

    expect(verification.passed).toBe(true);
    // The extension presentation should be used, not the CLI one
    expect(calledWith).toBe("ZXh0ZW5zaW9u");
  });
});
