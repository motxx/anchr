import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { evaluateCondition, validateTlsn, _setVerifierPathForTest } from "./tlsn-validation";
import type { TlsnAttestation, TlsnRequirement } from "../types";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Helpers ---

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

// --- Mock verifier binary ---

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
  _setVerifierPathForTest(undefined as unknown as null); // reset
  rmSync(mockVerifierDir, { recursive: true, force: true });
});

// --- Condition evaluation (pure functions, no binary needed) ---

describe("evaluateCondition", () => {
  const body = JSON.stringify({ bitcoin: { usd: 42000 }, ethereum: { usd: 3000 } });

  test("contains — match", () => {
    const result = evaluateCondition({ type: "contains", expression: "bitcoin" }, body);
    expect(result.passed).toBe(true);
  });

  test("contains — no match", () => {
    const result = evaluateCondition({ type: "contains", expression: "dogecoin" }, body);
    expect(result.passed).toBe(false);
  });

  test("regex — match", () => {
    const result = evaluateCondition({ type: "regex", expression: '"usd":\\s*\\d+' }, body);
    expect(result.passed).toBe(true);
    expect(result.actual_value).toBeTruthy();
  });

  test("regex — no match", () => {
    const result = evaluateCondition({ type: "regex", expression: '"eur":\\s*\\d+' }, body);
    expect(result.passed).toBe(false);
  });

  test("jsonpath — exists", () => {
    const result = evaluateCondition({ type: "jsonpath", expression: "bitcoin.usd" }, body);
    expect(result.passed).toBe(true);
    expect(result.actual_value).toBe("42000");
  });

  test("jsonpath — not found", () => {
    const result = evaluateCondition({ type: "jsonpath", expression: "bitcoin.eur" }, body);
    expect(result.passed).toBe(false);
  });

  test("jsonpath — with expected value match", () => {
    const result = evaluateCondition(
      { type: "jsonpath", expression: "bitcoin.usd", expected: "42000" },
      body,
    );
    expect(result.passed).toBe(true);
  });

  test("jsonpath — with expected value mismatch", () => {
    const result = evaluateCondition(
      { type: "jsonpath", expression: "bitcoin.usd", expected: "99999" },
      body,
    );
    expect(result.passed).toBe(false);
    expect(result.actual_value).toBe("42000");
  });

  test("jsonpath — invalid JSON body", () => {
    const result = evaluateCondition({ type: "jsonpath", expression: "foo" }, "not json");
    expect(result.passed).toBe(false);
    expect(result.actual_value).toBe("invalid JSON");
  });
});

// --- validateTlsn with no binary available ---

describe("validateTlsn without binary", () => {
  test("fails when binary not available", async () => {
    _setVerifierPathForTest(null);
    const result = await validateTlsn(makeAttestation(), makeRequirement());
    expect(result.available).toBe(false);
    expect(result.failures.some((f) => f.includes("binary not available"))).toBe(true);
  });
});

// --- validateTlsn with mock binary ---

describe("validateTlsn with mock binary", () => {
  test("valid presentation passes all checks", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "api.coingecko.com",
      revealed_body: '{"bitcoin":{"usd":42000}}',
      time: Math.floor(Date.now() / 1000) - 10,
    });
    _setVerifierPathForTest(mockVerifierPath);

    const result = await validateTlsn(
      makeAttestation(),
      makeRequirement({
        conditions: [{ type: "jsonpath", expression: "bitcoin.usd", description: "BTC price" }],
      }),
    );

    expect(result.signatureValid).toBe(true);
    expect(result.serverIdentityValid).toBe(true);
    expect(result.attestationFresh).toBe(true);
    expect(result.conditionResults[0]!.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.verifiedData?.server_name).toBe("api.coingecko.com");
    expect(result.verifiedData?.revealed_body).toBe('{"bitcoin":{"usd":42000}}');
  });

  test("invalid signature fails", async () => {
    writeMockVerifier({ valid: false, error: "signature mismatch" });
    _setVerifierPathForTest(mockVerifierPath);

    const result = await validateTlsn(makeAttestation(), makeRequirement());
    expect(result.signatureValid).toBe(false);
    expect(result.failures.some((f) => f.includes("signature invalid"))).toBe(true);
  });

  test("domain mismatch fails", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "evil.example.com",
      revealed_body: "{}",
      time: Math.floor(Date.now() / 1000) - 5,
    });
    _setVerifierPathForTest(mockVerifierPath);

    const result = await validateTlsn(makeAttestation(), makeRequirement());
    expect(result.serverIdentityValid).toBe(false);
    expect(result.failures.some((f) => f.includes("does not match target"))).toBe(true);
  });

  test("stale attestation fails freshness", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "api.coingecko.com",
      revealed_body: "{}",
      time: Math.floor(Date.now() / 1000) - 600, // 10 min ago
    });
    _setVerifierPathForTest(mockVerifierPath);

    const result = await validateTlsn(
      makeAttestation(),
      makeRequirement({ max_attestation_age_seconds: 300 }),
    );
    expect(result.attestationFresh).toBe(false);
    expect(result.failures.some((f) => f.includes("too old"))).toBe(true);
  });

  test("condition evaluation uses verified body", async () => {
    writeMockVerifier({
      valid: true,
      server_name: "api.coingecko.com",
      revealed_body: '{"bitcoin":{"usd":42000}}',
      time: Math.floor(Date.now() / 1000) - 5,
    });
    _setVerifierPathForTest(mockVerifierPath);

    const result = await validateTlsn(
      makeAttestation(),
      makeRequirement({
        conditions: [
          { type: "jsonpath", expression: "bitcoin.usd", description: "BTC price" },
          { type: "contains", expression: "dogecoin", description: "DOGE present" },
        ],
      }),
    );

    expect(result.conditionResults).toHaveLength(2);
    expect(result.conditionResults[0]!.passed).toBe(true);
    expect(result.conditionResults[1]!.passed).toBe(false);
    expect(result.checks.some((c) => c.includes("BTC price"))).toBe(true);
    expect(result.failures.some((f) => f.includes("DOGE present"))).toBe(true);
  });
});

// --- Integration: verify() with tlsn ---

describe("verify() integration with tlsn", () => {
  const { verify } = require("./verifier") as typeof import("./verifier");

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
