/**
 * Integration tests: verify() orchestrator + TLSNotary path.
 *
 * These exercise the host-side verifier, which composes SDK proof validation
 * with the rest of Anchr's verification pipeline. The pure TLSNotary unit tests
 * live in packages/sdk/src/proofs/tlsn-validation.test.ts.
 */

import { Buffer } from "node:buffer";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  test,
} from "@std/testing/bdd";
import { expect } from "@std/expect";
import { _clearSeenPresentationsForTest, validateTlsn } from "../mod.ts";
import type { VerifyProofOptions } from "./verifier.ts";
import { verify } from "../../requests/application/query-verifier.ts";
import { isTlsnVerifiedData } from "../tlsn-types.ts";
import type { TlsnAttestation, TlsnRequirement } from "../tlsn-types.ts";
import { ProofSchema } from "../../schema.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const NOTARY_PUBLIC_KEY =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

/**
 * Inject the real validateTlsn bound to a specific verifier binary path, so
 * the verify() orchestrator exercises the genuine TLSNotary path against the
 * mock verifier instead of auto-detecting a binary.
 */
function withVerifierPath(verifierPath: string | null): VerifyProofOptions {
  return {
    schemaOptions: {
      [ProofSchema.TlsnV1]: {
        verifierPath,
        notaryPublicKey: NOTARY_PUBLIC_KEY,
        validateTlsn,
      },
    },
  };
}

function makeAttestation(
  overrides?: Partial<TlsnAttestation>,
): TlsnAttestation {
  return {
    presentation: Buffer.from("fake-presentation").toString("base64"),
    ...overrides,
  };
}

function makeRequirement(
  overrides?: Partial<TlsnRequirement>,
): TlsnRequirement {
  return {
    target_url:
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    ...overrides,
  };
}

let mockVerifierDir: string;
let mockVerifierPath: string;

function writeMockVerifier(output: Record<string, unknown>) {
  const script = `#!/bin/bash\necho '${JSON.stringify(output)}'`;
  writeFileSync(mockVerifierPath, script, { mode: 0o755 });
}

beforeAll(() => {
  mockVerifierDir = mkdtempSync(join(tmpdir(), "anchr-tlsn-test-"));
  mockVerifierPath = join(mockVerifierDir, "tlsn-verifier");
});

afterAll(() => {
  rmSync(mockVerifierDir, { recursive: true, force: true });
});

describe("verify() integration with tlsn", () => {
  beforeEach(() => _clearSeenPresentationsForTest());

  test("tlsn query with missing attestation fails", async () => {
    const query = {
      id: "test_tlsn_1",
      schema: ProofSchema.TlsnV1,
      status: "pending" as const,
      description: "Test",
      verification_requirements: ["tlsn"] as const,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payment_status: "locked" as const,
      schema_requirement: makeRequirement(),
    };
    const result = { attachments: [] };

    const verification = await verify(query, result, withVerifierPath(null));
    expect(verification.passed).toBe(false);
    expect(
      verification.failures.some((f) => f.includes("no attestation provided")),
    ).toBe(true);
  });

  test("tlsn query without schema_requirement fails", async () => {
    const query = {
      id: "test_tlsn_2",
      schema: ProofSchema.TlsnV1,
      status: "pending" as const,
      description: "Test",
      verification_requirements: ["tlsn"] as const,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payment_status: "locked" as const,
    };
    const result = { attachments: [], schema_evidence: makeAttestation() };

    const verification = await verify(query, result, withVerifierPath(null));
    expect(verification.passed).toBe(false);
    expect(
      verification.failures.some((f) =>
        f.includes("missing or invalid schema_requirement")
      ),
    ).toBe(true);
  });

  test("tlsn query does not require photo attachments", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "api.coingecko.com",
      revealed_body: '{"bitcoin":{"usd":42000}}',
      time: Math.floor(Date.now() / 1000) - 5,
    });

    const query = {
      id: "test_tlsn_3",
      schema: ProofSchema.TlsnV1,
      status: "pending" as const,
      description: "Test",
      verification_requirements: ["tlsn"] as const,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payment_status: "locked" as const,
      schema_requirement: makeRequirement(),
    };
    const result = { attachments: [], schema_evidence: makeAttestation() };

    const verification = await verify(
      query,
      result,
      withVerifierPath(mockVerifierPath),
    );
    expect(verification.failures.filter((f) => f.includes("no media evidence")))
      .toHaveLength(0);
    expect(verification.passed).toBe(true);
    expect(isTlsnVerifiedData(verification.schema_verdict)).toBe(true);
    if (!isTlsnVerifiedData(verification.schema_verdict)) return;
    expect(verification.schema_verdict.server_name).toBe("api.coingecko.com");
  });
});
