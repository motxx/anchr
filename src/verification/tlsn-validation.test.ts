import { test, expect, describe } from "bun:test";
import { evaluateCondition, validateTlsn } from "./tlsn-validation";
import type { TlsnAttestation, TlsnCondition, TlsnRequirement } from "../types";

// --- Helpers ---

function makeAttestation(overrides?: Partial<TlsnAttestation>): TlsnAttestation {
  return {
    attestation_doc: Buffer.from("fake-attestation").toString("base64"),
    server_name: "api.coingecko.com",
    request_url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    revealed_body: JSON.stringify({ bitcoin: { usd: 42000 } }),
    notary_pubkey: "abc123",
    session_timestamp: Date.now() - 10_000, // 10 seconds ago
    ...overrides,
  };
}

function makeRequirement(overrides?: Partial<TlsnRequirement>): TlsnRequirement {
  return {
    target_url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    ...overrides,
  };
}

// --- Condition evaluation ---

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

// --- Freshness check ---

describe("freshness check", () => {
  test("fresh attestation passes", async () => {
    const result = await validateTlsn(
      makeAttestation({ session_timestamp: Date.now() - 10_000 }),
      makeRequirement({ max_attestation_age_seconds: 300 }),
      ["abc123"],
    );
    expect(result.attestationFresh).toBe(true);
    expect(result.failures.filter((f) => f.includes("too old"))).toHaveLength(0);
  });

  test("stale attestation fails", async () => {
    const result = await validateTlsn(
      makeAttestation({ session_timestamp: Date.now() - 600_000 }), // 10 min ago
      makeRequirement({ max_attestation_age_seconds: 300 }),
      ["abc123"],
    );
    expect(result.attestationFresh).toBe(false);
    expect(result.failures.some((f) => f.includes("too old"))).toBe(true);
  });

  test("default max age is 300 seconds", async () => {
    const result = await validateTlsn(
      makeAttestation({ session_timestamp: Date.now() - 200_000 }), // 200s ago
      makeRequirement(), // no max_attestation_age_seconds
      ["abc123"],
    );
    expect(result.attestationFresh).toBe(true);
  });
});

// --- Notary trust check ---

describe("notary trust check", () => {
  test("trusted notary passes", async () => {
    const result = await validateTlsn(
      makeAttestation({ notary_pubkey: "trusted_key" }),
      makeRequirement(),
      ["trusted_key", "other_key"],
    );
    expect(result.notaryTrusted).toBe(true);
  });

  test("untrusted notary fails", async () => {
    const result = await validateTlsn(
      makeAttestation({ notary_pubkey: "unknown_key" }),
      makeRequirement(),
      ["trusted_key"],
    );
    expect(result.notaryTrusted).toBe(false);
    expect(result.failures.some((f) => f.includes("not in trusted set"))).toBe(true);
  });

  test("empty trusted set skips check", async () => {
    const result = await validateTlsn(
      makeAttestation({ notary_pubkey: "any_key" }),
      makeRequirement(),
      [],
    );
    expect(result.notaryTrusted).toBe(true);
    expect(result.checks.some((c) => c.includes("trust check skipped"))).toBe(true);
  });
});

// --- Server name domain matching ---

describe("server identity check", () => {
  test("matching server name passes", async () => {
    const result = await validateTlsn(
      makeAttestation({ server_name: "api.coingecko.com" }),
      makeRequirement({ target_url: "https://api.coingecko.com/api/v3/simple/price" }),
      [],
    );
    expect(result.serverIdentityValid).toBe(true);
  });

  test("mismatched server name fails", async () => {
    const result = await validateTlsn(
      makeAttestation({ server_name: "evil.example.com" }),
      makeRequirement({ target_url: "https://api.coingecko.com/api/v3/simple/price" }),
      [],
    );
    expect(result.serverIdentityValid).toBe(false);
    expect(result.failures.some((f) => f.includes("does not match target"))).toBe(true);
  });
});

// --- Condition integration in validateTlsn ---

describe("conditions in validateTlsn", () => {
  test("conditions evaluated and reported", async () => {
    const result = await validateTlsn(
      makeAttestation(),
      makeRequirement({
        conditions: [
          { type: "jsonpath", expression: "bitcoin.usd", description: "BTC price exists" },
          { type: "contains", expression: "dogecoin", description: "DOGE present" },
        ],
      }),
      [],
    );
    expect(result.conditionResults).toHaveLength(2);
    expect(result.conditionResults[0]!.passed).toBe(true);
    expect(result.conditionResults[1]!.passed).toBe(false);
    expect(result.checks.some((c) => c.includes("BTC price exists"))).toBe(true);
    expect(result.failures.some((f) => f.includes("DOGE present"))).toBe(true);
  });
});

// --- Integration: verify() with tlsn ---

describe("verify() integration with tlsn", () => {
  const { verify } = require("./verifier") as typeof import("./verifier");

  test("tlsn query with valid attestation passes structural checks", async () => {
    const query = {
      id: "test_tlsn_1",
      status: "pending" as const,
      description: "Verify BTC price",
      verification_requirements: ["tlsn"] as const,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payment_status: "locked" as const,
      tlsn_requirements: makeRequirement({
        conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
      }),
    };
    const result = {
      attachments: [],
      tlsn_attestation: makeAttestation(),
    };

    const verification = await verify(query, result);
    // Should not fail on "no media evidence" since tlsn is the factor
    expect(verification.failures.filter((f) => f.includes("no media evidence"))).toHaveLength(0);
    // Should have TLSNotary checks
    expect(verification.checks.some((c) => c.includes("TLSNotary"))).toBe(true);
  });

  test("tlsn query with missing attestation fails", async () => {
    const query = {
      id: "test_tlsn_2",
      status: "pending" as const,
      description: "Verify BTC price",
      verification_requirements: ["tlsn"] as const,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payment_status: "locked" as const,
      tlsn_requirements: makeRequirement(),
    };
    const result = {
      attachments: [],
    };

    const verification = await verify(query, result);
    expect(verification.passed).toBe(false);
    expect(verification.failures.some((f) => f.includes("no attestation provided"))).toBe(true);
  });

  test("tlsn query without tlsn_requirements fails", async () => {
    const query = {
      id: "test_tlsn_3",
      status: "pending" as const,
      description: "Verify BTC price",
      verification_requirements: ["tlsn"] as const,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payment_status: "locked" as const,
      // no tlsn_requirements
    };
    const result = {
      attachments: [],
      tlsn_attestation: makeAttestation(),
    };

    const verification = await verify(query, result);
    expect(verification.passed).toBe(false);
    expect(verification.failures.some((f) => f.includes("missing tlsn_requirements"))).toBe(true);
  });
});
