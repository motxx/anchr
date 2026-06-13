import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  getOracle,
  listOracles,
  registerOracle,
  resolveOracle,
} from "./registry.ts";
import type {
  Oracle,
  OracleAttestation,
} from "../../requests/domain/oracle-types.ts";
import type { Query, QueryResult } from "../../requests/domain/types.ts";

function makeFakeOracle(id: string, feePpm = 50_000): Oracle {
  return {
    info: { id, name: `Oracle ${id}`, fee_ppm: feePpm },
    async verify(
      _query: Query,
      _result: QueryResult,
    ): Promise<OracleAttestation> {
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

// --- Registry ---

test("module registry starts empty", () => {
  expect(listOracles()).toEqual([]);
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
  const fake = makeFakeOracle("resolve-test-oracle");
  registerOracle(fake);

  const oracle = resolveOracle("resolve-test-oracle", undefined);
  expect(oracle).toBe(fake);
});

test("resolveOracle with explicit id checks acceptable set", () => {
  const fake = makeFakeOracle("test-oracle-2");
  registerOracle(fake);

  expect(resolveOracle("test-oracle-2", ["test-oracle-2", "other-oracle"]))
    .toBe(fake);

  expect(resolveOracle("test-oracle-2", ["other-oracle"])).toBe(null);
});

test("resolveOracle with no explicit id and single acceptable → uses that one", () => {
  const fake = makeFakeOracle("test-oracle-3");
  registerOracle(fake);

  const oracle = resolveOracle(undefined, ["test-oracle-3"]);
  expect(oracle).toBe(fake);
});

test("resolveOracle with no explicit id and no acceptable returns null", () => {
  const oracle = resolveOracle(undefined, undefined);
  expect(oracle).toBeNull();
});

test("resolveOracle with no explicit id and empty acceptable returns null", () => {
  const oracle = resolveOracle(undefined, []);
  expect(oracle).toBeNull();
});

test("resolveOracle with unknown explicit id → null", () => {
  expect(resolveOracle("does-not-exist", undefined)).toBe(null);
});
