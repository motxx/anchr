import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { BUILT_IN_ORACLE_ID, builtInOracle } from "./built-in";
import { getOracle, listOracles, registerOracle, resolveOracle } from "./registry";
import type { Oracle, OracleAttestation } from "./types";
import type { Query, QueryResult } from "../domain/types";

function makeFakeOracle(id: string, feePpm = 50_000): Oracle {
  return {
    info: { id, name: `Oracle ${id}`, fee_ppm: feePpm },
    async verify(_query: Query, _result: QueryResult): Promise<OracleAttestation> {
      return {
        oracle_id: id,
        query_id: _query.id,
        passed: true,
        checks: ["fake check"],
        failures: [],
        attested_at: Date.now(),
      };
    },
  };
}

// --- Built-in Oracle ---

test("built-in oracle has correct info", () => {
  expect(builtInOracle.info.id).toBe("built-in");
  expect(builtInOracle.info.fee_ppm).toBe(0);
});

test("built-in oracle verify returns attestation", async () => {
  const query: Query = {
    id: "q1",
    status: "pending",
    description: "Test query",
    challenge_nonce: "ABC",
    challenge_rule: "test",
    verification_requirements: ["ai_check"],
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
    payment_status: "locked",
  };
  const result: QueryResult = { attachments: [], notes: "open" };

  const attestation = await builtInOracle.verify(query, result);

  expect(attestation.oracle_id).toBe(BUILT_IN_ORACLE_ID);
  expect(attestation.query_id).toBe("q1");
  expect(attestation.passed).toBe(true);
  expect(attestation.attested_at).toBeGreaterThan(0);
});

// --- Registry ---

test("built-in oracle is registered by default", () => {
  expect(getOracle(BUILT_IN_ORACLE_ID)).toBe(builtInOracle);
});

test("listOracles includes built-in", () => {
  const infos = listOracles();
  expect(infos.some((i) => i.id === BUILT_IN_ORACLE_ID)).toBe(true);
});

test("registerOracle adds a new oracle", () => {
  const fake = makeFakeOracle("test-oracle-1");
  registerOracle(fake);
  expect(getOracle("test-oracle-1")).toBe(fake);
  expect(listOracles().some((i) => i.id === "test-oracle-1")).toBe(true);
});

test("getOracle returns null for unknown id", () => {
  expect(getOracle("nonexistent")).toBe(null);
});

// --- resolveOracle ---

test("resolveOracle with explicit id returns that oracle", () => {
  const oracle = resolveOracle(BUILT_IN_ORACLE_ID, undefined);
  expect(oracle).toBe(builtInOracle);
});

test("resolveOracle with explicit id checks acceptable set", () => {
  const fake = makeFakeOracle("test-oracle-2");
  registerOracle(fake);

  // Oracle is in acceptable set → ok
  expect(resolveOracle("test-oracle-2", ["test-oracle-2", BUILT_IN_ORACLE_ID])).toBe(fake);

  // Oracle is NOT in acceptable set → rejected
  expect(resolveOracle("test-oracle-2", [BUILT_IN_ORACLE_ID])).toBe(null);
});

test("resolveOracle with no explicit id and single acceptable → uses that one", () => {
  const fake = makeFakeOracle("test-oracle-3");
  registerOracle(fake);

  const oracle = resolveOracle(undefined, ["test-oracle-3"]);
  expect(oracle).toBe(fake);
});

test("resolveOracle with no explicit id and no acceptable → built-in", () => {
  const oracle = resolveOracle(undefined, undefined);
  expect(oracle).toBe(builtInOracle);
});

test("resolveOracle with no explicit id and empty acceptable → built-in", () => {
  const oracle = resolveOracle(undefined, []);
  expect(oracle).toBe(builtInOracle);
});

test("resolveOracle with unknown explicit id → null", () => {
  expect(resolveOracle("does-not-exist", undefined)).toBe(null);
});
