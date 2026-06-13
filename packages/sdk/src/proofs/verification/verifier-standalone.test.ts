/**
 * Standalone-API tests: verifyProof() called directly without a lifecycle envelope.
 *
 * Asserts that fixed-stakeholder use cases can drive verification by
 * constructing a VerificationRequirement instead of going through
 * lifecycle request/result types.
 */

import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { verifyProof } from "./verifier.ts";
import {
  requestToRequirement,
  resultToVerificationInput,
  verify,
} from "../../requests/application/query-verifier.ts";
import {
  clearIntegrityStore,
  createIntegrityStore,
  storeIntegrity,
} from "../mod.ts";
import { isTlsnVerifiedData } from "../tlsn-types.ts";
import type { TlsnAttestation, TlsnRequirement } from "../tlsn-types.ts";
import type { VerificationInput, VerificationRequirement } from "./contract.ts";
import type { TlsnValidationResult } from "../mod.ts";
import { makeQuery } from "../../testing/factories.ts";
import { ProofSchema } from "../../schema.ts";

const now = Math.floor(Date.now() / 1000);

function injectC2paIntegrity(attachmentId: string, requirementId: string) {
  storeIntegrity({
    attachmentId,
    requestId: requirementId,
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
      checks: [],
      failures: [],
    },
  });
}

describe("verifyProof — standalone (no Query envelope)", () => {
  beforeEach(() => {
    clearIntegrityStore();
  });

  test("rejects empty submission when C2PA factor is set", async () => {
    const requirement: VerificationRequirement = {
      id: "req_1",
      schema: ProofSchema.C2paImageV1,
      factors: ["c2pa"],
      schema_requirement: { expected_gps: { lat: 35.0, lon: 139.0 } },
    };
    const input: VerificationInput = { attachments: [] };

    const verification = await verifyProof(requirement, input);

    expect(verification.passed).toBe(false);
    expect(verification.failures).toContain(
      "no media evidence provided — photos are required when photo-backed verification is enabled",
    );
  });

  test("rejects empty submission for the default generic-media schema", async () => {
    const requirement: VerificationRequirement = {
      id: "req_default_media",
      factors: [],
    };
    const input: VerificationInput = { attachments: [] };

    const verification = await verifyProof(requirement, input);

    expect(verification.passed).toBe(false);
    expect(verification.failures).toContain(
      "no media evidence provided — photos are required when photo-backed verification is enabled",
    );
  });

  test("an injected integrity store is honoured instead of the global singleton", async () => {
    const requirement: VerificationRequirement = {
      id: "req_injected_store",
      schema: ProofSchema.C2paImageV1,
      factors: ["c2pa"],
    };
    const input: VerificationInput = {
      attachments: [{
        id: "photo_injected",
        uri: "https://blossom.example.com/photo_injected",
        mime_type: "image/jpeg",
        storage_kind: "blossom",
        blossom_hash: "photo_injected",
      }],
    };

    // The record lives only in the host-composed store; the global
    // singleton stays empty.
    const integrityStore = createIntegrityStore();
    integrityStore.store({
      attachmentId: "photo_injected",
      requestId: requirement.id,
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
        checks: [],
        failures: [],
      },
    });

    const withInjected = await verifyProof(requirement, input, {
      schemaOptions: {
        [ProofSchema.C2paImageV1]: { integrityStore },
      },
    });
    expect(withInjected.passed).toBe(true);

    const withGlobal = await verifyProof(requirement, input);
    expect(withGlobal.passed).toBe(false);
  });

  test("accepts C2PA evidence without location payload when no expected location is set", async () => {
    const requirement: VerificationRequirement = {
      id: "req_c2pa_no_expected",
      schema: ProofSchema.C2paImageV1,
      factors: ["c2pa"],
    };
    const input: VerificationInput = {
      attachments: [{
        id: "photo_b",
        uri: "https://blossom.example.com/photo_b",
        mime_type: "image/jpeg",
        storage_kind: "blossom",
        blossom_hash: "photo_b",
      }],
    };

    injectC2paIntegrity("photo_b", requirement.id);
    const verification = await verifyProof(requirement, input);

    expect(verification.passed).toBe(true);
  });

  test("rejects C2PA schema evidence GPS far from expected location", async () => {
    const requirement: VerificationRequirement = {
      id: "req_3",
      schema: ProofSchema.C2paImageV1,
      factors: ["c2pa"],
      schema_requirement: {
        expected_gps: { lat: 35.0, lon: 139.0 },
        max_gps_distance_km: 10,
      },
    };
    const input: VerificationInput = {
      attachments: [],
      schema_evidence: { gps: { lat: 36.0, lon: 140.0 } },
    };

    const verification = await verifyProof(requirement, input);

    expect(verification.passed).toBe(false);
    expect(
      verification.failures.some((f) => f.includes("from expected location")),
    ).toBe(true);
  });

  test("attachment with valid C2PA passes via integrity-store keyed by requirement.id", async () => {
    const requirement: VerificationRequirement = {
      id: "req_c2pa",
      schema: ProofSchema.C2paImageV1,
      factors: ["c2pa"],
    };
    const input: VerificationInput = {
      attachments: [{
        id: "photo_a",
        uri: "https://blossom.example.com/photo_a",
        mime_type: "image/jpeg",
        storage_kind: "blossom",
        blossom_hash: "photo_a",
      }],
    };

    injectC2paIntegrity("photo_a", requirement.id);
    const verification = await verifyProof(requirement, input);

    expect(verification.passed).toBe(true);
    expect(verification.checks).toContain(
      "C2PA: valid Content Credentials signature",
    );
  });

  test("TLSNotary path runs validateTlsn() against the requirement's schema_requirement", async () => {
    const tlsnReq: TlsnRequirement = {
      target_url: "https://api.example.com/balance",
      conditions: [{
        type: "contains",
        expression: "balance",
        description: "must contain balance",
      }],
    };

    let receivedReq: TlsnRequirement | undefined;
    const validateTlsnMock = async (
      _att: TlsnAttestation,
      req: TlsnRequirement,
    ): Promise<TlsnValidationResult> => {
      receivedReq = req;
      return {
        available: true,
        signatureValid: true,
        serverIdentityValid: true,
        conditionResults: [{
          condition: { type: "contains", expression: "balance" },
          passed: true,
          actual_value: "balance: 1000",
        }],
        attestationFresh: true,
        verifiedData: {
          server_name: "api.example.com",
          revealed_body: '{"balance": 1000}',
          session_timestamp: now,
        },
        checks: [
          "TLSNotary: presentation signature valid (cryptographically verified)",
        ],
        failures: [],
      };
    };

    const requirement: VerificationRequirement = {
      id: "req_tlsn_standalone",
      schema: ProofSchema.TlsnV1,
      factors: ["tlsn"],
      schema_requirement: tlsnReq,
    };
    const input: VerificationInput = {
      attachments: [],
      schema_evidence: { presentation: "dGVzdA==" },
    };

    const verification = await verifyProof(requirement, input, {
      schemaOptions: {
        [ProofSchema.TlsnV1]: { validateTlsn: validateTlsnMock },
      },
    });

    expect(verification.passed).toBe(true);
    expect(receivedReq).toBe(tlsnReq);
    expect(isTlsnVerifiedData(verification.schema_verdict)).toBe(true);
    if (!isTlsnVerifiedData(verification.schema_verdict)) return;
    expect(verification.schema_verdict.server_name).toBe("api.example.com");
  });
});

describe("requestToRequirement / resultToVerificationInput adapter parity", () => {
  beforeEach(() => {
    clearIntegrityStore();
  });

  test("standalone verifyProof produces the same output as the Query-based path", async () => {
    const query = makeQuery({
      id: "query_parity",
      schema: ProofSchema.C2paImageV1,
      verification_requirements: ["c2pa"],
      schema_requirement: {
        expected_gps: { lat: 35.0, lon: 139.0 },
        max_gps_distance_km: 50,
      },
      expires_at: Date.now() + 60_000,
    });
    const result = {
      attachments: [],
      schema_evidence: { gps: { lat: 35.001, lon: 139.001 } },
    };

    const viaQuery = await verify(query, result);
    const viaStandalone = await verifyProof(
      requestToRequirement(query),
      resultToVerificationInput(result),
    );

    expect(viaStandalone.passed).toBe(viaQuery.passed);
    expect(viaStandalone.checks).toEqual(viaQuery.checks);
    expect(viaStandalone.failures).toEqual(viaQuery.failures);
    expect(
      viaStandalone.checks.some((c) =>
        c.includes("C2PA schema_evidence GPS within 50km")
      ),
    ).toBe(true);
  });

  test("requestToRequirement carries every security-relevant field", () => {
    const tlsnReq: TlsnRequirement = {
      target_url: "https://example.com/x",
      conditions: [{ type: "contains", expression: "x", description: "x" }],
    };
    const query = makeQuery({
      id: "query_carry",
      description: "describe the proof",
      challenge_nonce: "ABCD",
      verification_requirements: ["tlsn", "c2pa"],
      schema_requirement: tlsnReq,
    });

    const requirement = requestToRequirement(query);

    expect(requirement.id).toBe("query_carry");
    expect(requirement.description).toBe("describe the proof");
    expect(requirement.challenge_nonce).toBe("ABCD");
    expect(requirement.factors).toEqual(["tlsn", "c2pa"]);
    expect(requirement.schema_requirement).toBe(tlsnReq);
  });
});
