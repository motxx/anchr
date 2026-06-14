import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { verify } from "../../requests/application/query-verifier.ts";
import { clearIntegrityStore, storeIntegrity } from "../mod.ts";
import type { Query, QueryResult } from "../../requests/domain/types.ts";
import { isTlsnVerifiedData } from "../tlsn-types.ts";
import type { TlsnAttestation, TlsnRequirement } from "../tlsn-types.ts";
import type { TlsnValidationResult } from "../mod.ts";
import { makeQuery as makeBaseQuery } from "../../testing/factories.ts";
import { ProofSchema } from "../../schema.ts";

function makeQuery(overrides: Partial<Query>): Query {
  return makeBaseQuery({
    id: "query_test",
    challenge_nonce: "K7P4",
    challenge_rule: "include nonce",
    verification_requirements: ["nonce", "c2pa"],
    schema: ProofSchema.C2paImageV1,
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

test("rejects empty submission when C2PA/nonce required", async () => {
  const query = makeQuery({});
  const result: QueryResult = {
    attachments: [],
    notes: "",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "no media evidence provided — photos are required when photo-backed verification is enabled",
  );
});

test("empty submission fails when nonce evidence is required", async () => {
  const query = makeQuery({
    verification_requirements: ["nonce"],
    payment_lock: undefined,
  });
  const result: QueryResult = {
    attachments: [],
    notes: "text only",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "no media evidence provided — photos are required when photo-backed verification is enabled",
  );
});

test("empty submission fails when C2PA verification is required", async () => {
  const query = makeQuery({
    verification_requirements: ["c2pa"],
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
    schema_requirement: {
      expected_gps: { lat: 35.6762, lon: 139.6503 },
    },
    verification_requirements: ["c2pa"],
  });
  const result: QueryResult = {
    attachments: [{
      id: "photo1",
      uri: "https://blossom.example.com/photo1",
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      blossom_hash: "photo1",
    }],
    schema_evidence: { gps: { lat: 35.6762, lon: 139.6503 } },
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

test("payment_lock query without proof requirements accepts empty submission as weak verification", async () => {
  const query = makeQuery({
    schema: "https://anchr-spec.org/spec/proof/photo/v1",
    payment_lock: { amount_sats: 100 },
    verification_requirements: [],
  });
  const result: QueryResult = {
    attachments: [],
    notes: "Observed the target",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(true);
  expect(verification.checks).toContain(
    "no media evidence provided (weak verification)",
  );
});

test("generic media query with schema_requirement rejects empty submission", async () => {
  const query = makeQuery({
    schema: "https://anchr-spec.org/spec/proof/photo/v1",
    verification_requirements: [],
    schema_requirement: { expected_gps: { lat: 35.6762, lon: 139.6503 } },
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

test("payment_lock query with C2PA requirement rejects empty submission", async () => {
  const query = makeQuery({
    payment_lock: { amount_sats: 100 },
    verification_requirements: ["c2pa"],
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

test("ATTACK: c2pa-image rejects self-reported GPS without a signed manifest", async () => {
  const query = makeQuery({
    schema_requirement: {
      expected_gps: { lat: 35.6762, lon: 139.6503 },
    },
    verification_requirements: ["c2pa"],
  });
  const result: QueryResult = {
    attachments: [],
    notes: "nearby",
    schema_evidence: { gps: { lat: 35.68, lon: 139.65 } },
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "no media evidence provided — photos are required when photo-backed verification is enabled",
  );
  expect(verification.failures).toContain(
    "C2PA: required Content Credentials evidence missing — no image submitted",
  );
  expect(
    verification.checks.some((c) =>
      c.includes("C2PA schema_evidence GPS within")
    ),
  ).toBe(true);
});

test("C2PA schema evidence GPS too far fails", async () => {
  const query = makeQuery({
    schema_requirement: {
      expected_gps: { lat: 35.6762, lon: 139.6503 },
    },
    verification_requirements: ["c2pa"],
  });
  const result: QueryResult = {
    attachments: [],
    notes: "far away",
    schema_evidence: { gps: { lat: 40.0, lon: 140.0 } },
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(
    verification.failures.some((f) =>
      f.includes("C2PA schema_evidence GPS") &&
      f.includes("from expected location")
    ),
  ).toBe(true);
});

test("missing signed C2PA manifest fails when expected location is set", async () => {
  const query = makeQuery({
    schema_requirement: {
      expected_gps: { lat: 35.6762, lon: 139.6503 },
    },
    verification_requirements: ["c2pa"],
  });
  const result: QueryResult = {
    attachments: [],
    notes: "no gps",
  };

  const verification = await verify(query, result);

  expect(verification.passed).toBe(false);
  expect(verification.failures).toContain(
    "C2PA: required Content Credentials evidence missing — no image submitted",
  );
});

// --- TLSNotary extension result path ---

function makeTlsnQuery(overrides: Partial<Query> = {}): Query {
  return {
    id: "query_tlsn",
    status: "pending",
    description: "TLSNotary test",
    schema: ProofSchema.TlsnV1,
    verification_requirements: ["tlsn"],
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
    payment_status: "locked",
    schema_requirement: {
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
      schema_evidence: { presentation: "dGVzdA==" },
    };

    const verification = await verify(query, result, {
      schemaOptions: {
        [ProofSchema.TlsnV1]: { validateTlsn: mockValidateTlsnSuccess() },
      },
    });

    expect(verification.passed).toBe(true);
    expect(
      verification.checks.some((c) => c.includes("cryptographically verified")),
    ).toBe(true);
    expect(verification.checks.some((c) => c.includes("server name matches")))
      .toBe(true);
  });

  test("extension result + presentation + verification pass → schema_verdict data is returned", async () => {
    const query = makeTlsnQuery();
    const result: QueryResult = {
      attachments: [],
      schema_evidence: { presentation: "dGVzdA==" },
    };

    const verification = await verify(query, result, {
      schemaOptions: {
        [ProofSchema.TlsnV1]: { validateTlsn: mockValidateTlsnSuccess() },
      },
    });

    expect(verification.schema_verdict).toBeDefined();
    expect(isTlsnVerifiedData(verification.schema_verdict)).toBe(true);
    if (!isTlsnVerifiedData(verification.schema_verdict)) return;
    expect(verification.schema_verdict.server_name).toBe("httpbin.org");
    expect(verification.schema_verdict.revealed_body).toContain("httpbin");
    expect(verification.schema_verdict.session_timestamp).toBe(now);
  });

  test("extension result + presentation + verification failure → failures populated", async () => {
    const query = makeTlsnQuery();
    const result: QueryResult = {
      attachments: [],
      schema_evidence: { presentation: "dGVzdA==" },
    };

    const verification = await verify(query, result, {
      schemaOptions: {
        [ProofSchema.TlsnV1]: { validateTlsn: mockValidateTlsnFailure() },
      },
    });

    expect(verification.passed).toBe(false);
    expect(verification.failures.some((f) => f.includes("signature invalid")))
      .toBe(true);
    expect(verification.schema_verdict).toBeUndefined();
  });

  test("extension result WITHOUT presentation → rejected (self-reported data not trusted)", async () => {
    const query = makeTlsnQuery();
    const result: QueryResult = {
      attachments: [],
      schema_evidence: {
        results: [{ type: "text", part: "body", value: "fake data" }],
      },
    };

    // The injected validator should NOT be called for self-reported data.
    const verification = await verify(query, result, {
      schemaOptions: {
        [ProofSchema.TlsnV1]: { validateTlsn: mockValidateTlsnSuccess() },
      },
    });

    expect(verification.passed).toBe(false);
    expect(verification.failures).toContain(
      "TLSNotary extension: no cryptographic presentation included — self-reported data cannot be trusted",
    );
  });

  test("extension result + presentation BUT no schema_requirement → rejected", async () => {
    const query = makeTlsnQuery({ schema_requirement: undefined });
    const result: QueryResult = {
      attachments: [],
      schema_evidence: { presentation: "dGVzdA==" },
    };

    // The injected validator should NOT be called without schema_requirement.
    const verification = await verify(query, result, {
      schemaOptions: {
        [ProofSchema.TlsnV1]: { validateTlsn: mockValidateTlsnSuccess() },
      },
    });

    expect(verification.passed).toBe(false);
    expect(verification.failures).toContain(
      "TLSNotary: query missing or invalid schema_requirement",
    );
  });

  test("schema evidence presentation is passed to the validator", async () => {
    const query = makeTlsnQuery();
    const result: QueryResult = {
      attachments: [],
      schema_evidence: { presentation: "ZXh0ZW5zaW9u" },
    };

    let calledWith: string | undefined;
    const verification = await verify(query, result, {
      schemaOptions: {
        [ProofSchema.TlsnV1]: {
          validateTlsn: async (
            att: TlsnAttestation,
            req: TlsnRequirement,
          ): Promise<TlsnValidationResult> => {
            calledWith = att.presentation;
            return mockValidateTlsnSuccess()(att, req);
          },
        },
      },
    });

    expect(verification.passed).toBe(true);
    expect(calledWith).toBe("ZXh0ZW5zaW9u");
  });
});
