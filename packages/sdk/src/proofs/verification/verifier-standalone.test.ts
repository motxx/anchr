/**
 * Standalone-API tests: verifyProof() called directly without a lifecycle envelope.
 *
 * Asserts that fixed-stakeholder use cases can drive verification by
 * constructing a VerificationRequirement instead of going through
 * lifecycle request/result types.
 */

import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  requestToRequirement,
  resultToVerificationInput,
  verify,
  verifyProof,
} from "./verifier.ts";
import { clearIntegrityStore, storeIntegrity } from "../mod.ts";
import type { TlsnAttestation, TlsnRequirement } from "../tlsn-types.ts";
import type {
  VerificationInput,
  VerificationRequirement,
} from "../../requests/domain/types.ts";
import type { TlsnValidationResult } from "../mod.ts";
import { makeQuery } from "../../testing/factories.ts";

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

  test("rejects empty submission when GPS factor is set", async () => {
    const requirement: VerificationRequirement = {
      id: "req_1",
      factors: ["gps"],
      expected_gps: { lat: 35.0, lon: 139.0 },
    };
    const input: VerificationInput = { attachments: [] };

    const verification = await verifyProof(requirement, input);

    expect(verification.passed).toBe(false);
    expect(verification.failures).toContain(
      "no media evidence provided — photos are required when photo-backed verification is enabled",
    );
  });

  test("passes empty submission when only ai_check is requested", async () => {
    const requirement: VerificationRequirement = {
      id: "req_2",
      factors: ["ai_check"],
    };
    const input: VerificationInput = { attachments: [] };

    const verification = await verifyProof(requirement, input);

    expect(verification.passed).toBe(true);
    expect(verification.checks).toContain(
      "no media evidence provided (weak verification)",
    );
  });

  test("rejects body GPS far from expected location", async () => {
    const requirement: VerificationRequirement = {
      id: "req_3",
      factors: ["gps"],
      expected_gps: { lat: 35.0, lon: 139.0 },
      max_gps_distance_km: 10,
    };
    const input: VerificationInput = {
      attachments: [],
      gps: { lat: 36.0, lon: 140.0 },
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
      factors: ["gps", "ai_check"],
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

  test("TLSNotary path runs validateTlsn() against the requirement's tlsn_requirements", async () => {
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
      factors: ["tlsn"],
      tlsn_requirements: tlsnReq,
    };
    const input: VerificationInput = {
      attachments: [],
      tlsn_attestation: { presentation: "dGVzdA==" },
    };

    const verification = await verifyProof(requirement, input, {
      validateTlsn: validateTlsnMock,
    });

    expect(verification.passed).toBe(true);
    expect(receivedReq).toBe(tlsnReq);
    expect(verification.tlsn_verified?.server_name).toBe("api.example.com");
  });
});

describe("requestToRequirement / resultToVerificationInput adapter parity", () => {
  beforeEach(() => {
    clearIntegrityStore();
  });

  test("standalone verifyProof produces the same output as the Query-based path", async () => {
    const query = makeQuery({
      id: "query_parity",
      verification_requirements: ["gps"],
      expected_gps: { lat: 35.0, lon: 139.0 },
      max_gps_distance_km: 50,
      expires_at: Date.now() + 60_000,
    });
    const result = {
      attachments: [],
      gps: { lat: 35.001, lon: 139.001 },
    };

    const viaQuery = await verify(query, result);
    const viaStandalone = await verifyProof(
      requestToRequirement(query),
      resultToVerificationInput(result),
    );

    expect(viaStandalone.passed).toBe(viaQuery.passed);
    expect(viaStandalone.checks).toEqual(viaQuery.checks);
    expect(viaStandalone.failures).toEqual(viaQuery.failures);
    expect(viaStandalone.checks.some((c) => c.includes("body GPS within 50km")))
      .toBe(true);
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
      verification_requirements: ["tlsn", "gps"],
      expected_gps: { lat: 1, lon: 2 },
      max_gps_distance_km: 25,
      tlsn_requirements: tlsnReq,
    });

    const requirement = requestToRequirement(query);

    expect(requirement.id).toBe("query_carry");
    expect(requirement.description).toBe("describe the proof");
    expect(requirement.challenge_nonce).toBe("ABCD");
    expect(requirement.factors).toEqual(["tlsn", "gps"]);
    expect(requirement.expected_gps).toEqual({ lat: 1, lon: 2 });
    expect(requirement.max_gps_distance_km).toBe(25);
    expect(requirement.tlsn_requirements).toBe(tlsnReq);
  });
});
