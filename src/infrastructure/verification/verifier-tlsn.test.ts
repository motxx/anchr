/**
 * Integration tests: verify() orchestrator + TLSNotary path.
 *
 * These exercise the host-side verifier (which composes tlsn-toolkit's
 * validateTlsn with the rest of Anchr's verification pipeline). The pure
 * unit tests for tlsn-toolkit live in
 * packages/tlsn-toolkit/src/tlsn-validation.test.ts.
 */

import { Buffer } from "node:buffer";
import { afterAll, beforeAll, beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { _setVerifierPathForTest, _clearSeenPresentationsForTest } from "../../../packages/tlsn-toolkit/src/tlsn-validation";
import { verify } from "./verifier";
import type { TlsnAttestation, TlsnRequirement } from "../../../packages/core-domain/src/types";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeAttestation(overrides?: Partial<TlsnAttestation>): TlsnAttestation {
  return {
    presentation: Buffer.from("fake-presentation").toString("base64"),
    ...overrides,
  };
}

function makeRequirement(overrides?: Partial<TlsnRequirement>): TlsnRequirement {
  return {
    target_url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
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
  _setVerifierPathForTest(undefined as unknown as null);
  rmSync(mockVerifierDir, { recursive: true, force: true });
});

describe("verify() integration with tlsn", () => {
  beforeEach(() => _clearSeenPresentationsForTest());

  test("tlsn query with missing attestation fails", async () => {
    _setVerifierPathForTest(null);
    const query = {
      id: "test_tlsn_1",
      status: "pending" as const,
      description: "Test",
      verification_requirements: ["tlsn"] as const,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payment_status: "locked" as const,
      tlsn_requirements: makeRequirement(),
    };
    const result = { attachments: [] };

    const verification = await verify(query, result);
    expect(verification.passed).toBe(false);
    expect(verification.failures.some((f) => f.includes("no attestation provided"))).toBe(true);
  });

  test("tlsn query without tlsn_requirements fails", async () => {
    _setVerifierPathForTest(null);
    const query = {
      id: "test_tlsn_2",
      status: "pending" as const,
      description: "Test",
      verification_requirements: ["tlsn"] as const,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payment_status: "locked" as const,
    };
    const result = { attachments: [], tlsn_attestation: makeAttestation() };

    const verification = await verify(query, result);
    expect(verification.passed).toBe(false);
    expect(verification.failures.some((f) => f.includes("missing tlsn_requirements"))).toBe(true);
  });

  test("tlsn query does not require photo attachments", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "api.coingecko.com",
      revealed_body: '{"bitcoin":{"usd":42000}}',
      time: Math.floor(Date.now() / 1000) - 5,
    });
    _setVerifierPathForTest(mockVerifierPath);

    const query = {
      id: "test_tlsn_3",
      status: "pending" as const,
      description: "Test",
      verification_requirements: ["tlsn"] as const,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payment_status: "locked" as const,
      tlsn_requirements: makeRequirement(),
    };
    const result = { attachments: [], tlsn_attestation: makeAttestation() };

    const verification = await verify(query, result);
    expect(verification.failures.filter((f) => f.includes("no media evidence"))).toHaveLength(0);
    expect(verification.passed).toBe(true);
    expect(verification.tlsn_verified?.server_name).toBe("api.coingecko.com");
  });
});
