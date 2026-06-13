import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createOracleRegistry } from "./registry.ts";
import type {
  Oracle,
  OracleAttestation,
} from "../../requests/domain/oracle-types.ts";
import type { Query, QueryResult } from "../../requests/domain/types.ts";

function makeFakeOracle(id: string): Oracle {
  return {
    info: { id, name: `Fake ${id}`, fee_ppm: 10_000 },
    async verify(
      query: Query,
      _result: QueryResult,
    ): Promise<OracleAttestation> {
      return {
        oracle_id: id,
        query_id: query.id,
        passed: true,
        checks: ["ok"],
        failures: [],
        attested_at: Date.now(),
      };
    },
  };
}

describe("createOracleRegistry", () => {
  test("starts empty by default", () => {
    const registry = createOracleRegistry();
    expect(registry.list()).toHaveLength(0);
  });

  test("register adds an oracle", () => {
    const registry = createOracleRegistry();
    const oracle = makeFakeOracle("my-oracle");
    registry.register(oracle);
    expect(registry.get("my-oracle")).toBe(oracle);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]!.id).toBe("my-oracle");
  });

  test("register overwrites existing oracle with same id", () => {
    const registry = createOracleRegistry();
    const v1 = makeFakeOracle("oracle-x");
    const v2 = makeFakeOracle("oracle-x");
    registry.register(v1);
    registry.register(v2);
    expect(registry.get("oracle-x")).toBe(v2);
    expect(registry.list()).toHaveLength(1);
  });

  test("get returns null for unknown id", () => {
    const registry = createOracleRegistry();
    expect(registry.get("nonexistent")).toBeNull();
  });

  test("instances are isolated", () => {
    const r1 = createOracleRegistry();
    const r2 = createOracleRegistry();
    r1.register(makeFakeOracle("only-in-r1"));
    expect(r1.get("only-in-r1")).not.toBeNull();
    expect(r2.get("only-in-r1")).toBeNull();
  });
});

describe("resolve", () => {
  test("explicit oracleId returns that oracle", () => {
    const registry = createOracleRegistry();
    const oracle = makeFakeOracle("my-oracle");
    registry.register(oracle);
    expect(registry.resolve("my-oracle", undefined)).toBe(oracle);
  });

  test("explicit oracleId checks acceptableIds", () => {
    const registry = createOracleRegistry();
    const oracle = makeFakeOracle("my-oracle");
    registry.register(oracle);
    expect(registry.resolve("my-oracle", ["my-oracle"])).toBe(oracle);
    expect(registry.resolve("my-oracle", ["other"])).toBeNull();
  });

  test("no oracleId with single acceptable returns that oracle", () => {
    const registry = createOracleRegistry();
    const oracle = makeFakeOracle("sole-oracle");
    registry.register(oracle);
    expect(registry.resolve(undefined, ["sole-oracle"])).toBe(oracle);
  });

  test("no oracleId and no acceptable returns null", () => {
    const registry = createOracleRegistry();
    expect(registry.resolve(undefined, undefined)).toBeNull();
  });

  test("no oracleId and empty acceptable returns null", () => {
    const registry = createOracleRegistry();
    expect(registry.resolve(undefined, [])).toBeNull();
  });

  test("unknown explicit oracleId returns null", () => {
    const registry = createOracleRegistry();
    expect(registry.resolve("nonexistent", undefined)).toBeNull();
  });

  test("no oracleId with multiple acceptable returns null", () => {
    const registry = createOracleRegistry();
    registry.register(makeFakeOracle("a"));
    registry.register(makeFakeOracle("b"));
    expect(registry.resolve(undefined, ["a", "b"])).toBeNull();
  });
});

describe("resolveMultiple", () => {
  test("returns oracles matching acceptable IDs", () => {
    const registry = createOracleRegistry();
    registry.register(makeFakeOracle("a"));
    registry.register(makeFakeOracle("b"));
    registry.register(makeFakeOracle("c"));
    const result = registry.resolveMultiple(["a", "b"], 5);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.info.id)).toEqual(["a", "b"]);
  });

  test("returns all registered when acceptableIds is undefined", () => {
    const registry = createOracleRegistry();
    registry.register(makeFakeOracle("a"));
    registry.register(makeFakeOracle("b"));
    const result = registry.resolveMultiple(undefined, 10);
    expect(result).toHaveLength(2);
  });

  test("limits to count parameter", () => {
    const registry = createOracleRegistry();
    registry.register(makeFakeOracle("a"));
    registry.register(makeFakeOracle("b"));
    registry.register(makeFakeOracle("c"));
    const result = registry.resolveMultiple(undefined, 2);
    expect(result).toHaveLength(2);
  });

  test("skips unknown IDs in acceptable list", () => {
    const registry = createOracleRegistry();
    registry.register(makeFakeOracle("a"));
    const result = registry.resolveMultiple(
      ["a", "unknown", "also-unknown"],
      5,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.info.id).toBe("a");
  });

  test("returns empty when no oracles match", () => {
    const registry = createOracleRegistry();
    const result = registry.resolveMultiple(["unknown"], 5);
    expect(result).toHaveLength(0);
  });
});
