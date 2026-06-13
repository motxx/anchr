import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  type MultiOracleResolver,
  type OracleResolver,
  toAttestationRecord,
  verifyWithQuorum,
} from "./query-verification.ts";
import type { Oracle, OracleAttestation } from "../domain/oracle-types.ts";
import type { Query, QueryResult } from "../domain/types.ts";

function makeMockOracle(
  id: string,
  passFn?: (query: Query, result: QueryResult) => boolean,
): Oracle {
  return {
    info: { id, name: `Mock ${id}`, fee_ppm: 0 },
    async verify(
      query: Query,
      result: QueryResult,
    ): Promise<OracleAttestation> {
      const passed = passFn ? passFn(query, result) : true;
      return {
        oracle_id: id,
        query_id: query.id,
        passed,
        checks: passed ? [`${id} check passed`] : [],
        failures: passed ? [] : [`${id} check failed`],
        attested_at: Date.now(),
      };
    },
  };
}

function makeQuery(overrides?: Partial<Query>): Query {
  return {
    id: "test-query-1",
    status: "verifying",
    description: "Test query",
    verification_requirements: ["gps"],
    created_at: Date.now(),
    expires_at: Date.now() + 3600_000,
    payment_status: "none",
    ...overrides,
  };
}

function makeResult(): QueryResult {
  return {
    attachments: [],
    notes: "test result",
  };
}

function makeResolver(oracleMap: Record<string, Oracle>): OracleResolver {
  return (oracleId, acceptableIds) => {
    if (oracleId && oracleMap[oracleId]) {
      if (acceptableIds?.length && !acceptableIds.includes(oracleId)) {
        return null;
      }
      return oracleMap[oracleId];
    }
    if (acceptableIds?.length) {
      for (const id of acceptableIds) {
        if (oracleMap[id]) return oracleMap[id];
      }
      return null;
    }
    const values = Object.values(oracleMap);
    return values[0] ?? null;
  };
}

function makeMultiResolver(oracles: Oracle[]): MultiOracleResolver {
  return (acceptableIds, count) => {
    let pool = oracles;
    if (acceptableIds?.length) {
      pool = oracles.filter((o) => acceptableIds.includes(o.info.id));
    }
    return pool.slice(0, count);
  };
}

describe("toAttestationRecord", () => {
  test("maps OracleAttestation to OracleAttestationRecord", () => {
    const att: OracleAttestation = {
      oracle_id: "oracle-1",
      query_id: "q1",
      passed: true,
      checks: ["check1"],
      failures: [],
      attested_at: 1700000000,
      schema_verdict: {
        server_name: "example.com",
        revealed_body: "body",
        session_timestamp: 1700000000,
      },
    };
    const record = toAttestationRecord(att);

    expect(record.oracle_id).toBe("oracle-1");
    expect(record.passed).toBe(true);
    expect(record.checks).toEqual(["check1"]);
    expect(record.failures).toEqual([]);
    expect(record.attested_at).toBe(1700000000);
    expect(record.schema_verdict).toEqual({
      server_name: "example.com",
      revealed_body: "body",
      session_timestamp: 1700000000,
    });
  });

  test("handles attestation without schema_verdict", () => {
    const att: OracleAttestation = {
      oracle_id: "oracle-2",
      query_id: "q2",
      passed: false,
      checks: [],
      failures: ["failed check"],
      attested_at: 1700000000,
    };
    const record = toAttestationRecord(att);

    expect(record.passed).toBe(false);
    expect(record.failures).toEqual(["failed check"]);
    expect(record.schema_verdict).toBeUndefined();
  });
});

describe("verifyWithQuorum (single oracle)", () => {
  const passingOracle = makeMockOracle("oracle-pass");
  const failingOracle = makeMockOracle("oracle-fail", () => false);

  test("passes with a single passing oracle", async () => {
    const query = makeQuery();
    const resolver = makeResolver({ "oracle-pass": passingOracle });

    const result = await verifyWithQuorum(query, makeResult(), resolver);

    expect(result.passed).toBe(true);
    expect(result.attestations.length).toBe(1);
    expect(result.attestations[0].oracle_id).toBe("oracle-pass");
    expect(result.attestations[0].passed).toBe(true);
    expect(result.verification.passed).toBe(true);
    expect(result.verification.checks.length).toBeGreaterThan(0);
  });

  test("fails with a single failing oracle", async () => {
    const query = makeQuery();
    const resolver = makeResolver({ "oracle-fail": failingOracle });

    const result = await verifyWithQuorum(query, makeResult(), resolver);

    expect(result.passed).toBe(false);
    expect(result.attestations.length).toBe(1);
    expect(result.attestations[0].passed).toBe(false);
    expect(result.verification.passed).toBe(false);
    expect(result.verification.failures.length).toBeGreaterThan(0);
  });

  test("fails when no oracle is available", async () => {
    const query = makeQuery();
    const resolver = makeResolver({});

    const result = await verifyWithQuorum(query, makeResult(), resolver);

    expect(result.passed).toBe(false);
    expect(result.attestations.length).toBe(0);
    expect(result.verification.failures[0]).toContain("No oracle available");
  });

  test("selects specific oracle when oracleId is provided and query has oracle_ids", async () => {
    const query = makeQuery({ oracle_ids: ["oracle-pass", "oracle-fail"] });
    const resolver = makeResolver({
      "oracle-pass": passingOracle,
      "oracle-fail": failingOracle,
    });

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      undefined,
      undefined,
      "oracle-pass",
    );

    expect(result.passed).toBe(true);
    expect(result.attestations[0].oracle_id).toBe("oracle-pass");
  });

  test("returns error when requested oracleId is not in acceptable list", async () => {
    const query = makeQuery({ oracle_ids: ["oracle-pass"] });
    const resolver = makeResolver({
      "oracle-pass": passingOracle,
      "oracle-fail": failingOracle,
    });

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      undefined,
      undefined,
      "oracle-fail",
    );

    expect(result.passed).toBe(false);
    expect(result.verification.failures[0]).toContain(
      "not available or not accepted",
    );
  });
});

describe("CTF-1: oracle_id from provider sanitization", () => {
  test("ignores provider-supplied oracleId when query has no oracle_ids", async () => {
    const maliciousOracle = makeMockOracle("malicious-oracle", () => true);
    const defaultOracle = makeMockOracle("default-oracle");

    const query = makeQuery();
    const resolver = makeResolver({
      "malicious-oracle": maliciousOracle,
      "default-oracle": defaultOracle,
    });

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      undefined,
      undefined,
      "malicious-oracle",
    );

    expect(result.passed).toBe(true);
    expect(result.attestations.length).toBe(1);
  });

  test("uses provider-supplied oracleId when query has explicit oracle_ids", async () => {
    const oracleA = makeMockOracle("oracle-a");
    const oracleB = makeMockOracle("oracle-b");

    const query = makeQuery({ oracle_ids: ["oracle-a", "oracle-b"] });
    const resolver = makeResolver({
      "oracle-a": oracleA,
      "oracle-b": oracleB,
    });

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      undefined,
      undefined,
      "oracle-b",
    );

    expect(result.passed).toBe(true);
    expect(result.attestations[0].oracle_id).toBe("oracle-b");
  });

  test("ignores oracleId when oracle_ids is empty array", async () => {
    const oracleX = makeMockOracle("oracle-x");

    const query = makeQuery({ oracle_ids: [] });
    const resolver = makeResolver({ "oracle-x": oracleX });

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      undefined,
      undefined,
      "oracle-x",
    );

    expect(result.passed).toBe(true);
    expect(result.attestations.length).toBe(1);
  });
});

describe("verifyWithQuorum (multi-oracle quorum)", () => {
  test("passes when min_approvals are met", async () => {
    const oracles = [
      makeMockOracle("o1"),
      makeMockOracle("o2"),
      makeMockOracle("o3"),
    ];
    const query = makeQuery({
      quorum: { min_approvals: 2 },
      oracle_ids: ["o1", "o2", "o3"],
    });
    const resolver = makeResolver({});
    const multiResolver = makeMultiResolver(oracles);

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      multiResolver,
    );

    expect(result.passed).toBe(true);
    expect(result.attestations.length).toBeGreaterThanOrEqual(2);
    expect(result.verification.passed).toBe(true);
  });

  test("fails when fewer than min_approvals pass", async () => {
    const oracles = [
      makeMockOracle("o1", () => true),
      makeMockOracle("o2", () => false),
      makeMockOracle("o3", () => false),
    ];
    const query = makeQuery({
      quorum: { min_approvals: 2 },
      oracle_ids: ["o1", "o2", "o3"],
    });
    const resolver = makeResolver({});
    const multiResolver = makeMultiResolver(oracles);

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      multiResolver,
    );

    expect(result.passed).toBe(false);
    expect(result.verification.passed).toBe(false);
    expect(result.verification.failures.length).toBeGreaterThan(0);
  });

  test("passes with exactly min_approvals passing", async () => {
    const oracles = [
      makeMockOracle("o1", () => true),
      makeMockOracle("o2", () => true),
      makeMockOracle("o3", () => false),
    ];
    const query = makeQuery({
      quorum: { min_approvals: 2 },
      oracle_ids: ["o1", "o2", "o3"],
    });
    const resolver = makeResolver({});
    const multiResolver = makeMultiResolver(oracles);

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      multiResolver,
    );

    expect(result.passed).toBe(true);
    const passCount = result.attestations.filter((a) => a.passed).length;
    expect(passCount).toBe(2);
  });

  test("fails when not enough oracles are available", async () => {
    const oracles = [makeMockOracle("o1")];
    const query = makeQuery({
      quorum: { min_approvals: 3 },
      oracle_ids: ["o1", "o2", "o3"],
    });
    const resolver = makeResolver({});
    const multiResolver = makeMultiResolver(oracles);

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      multiResolver,
    );

    expect(result.passed).toBe(false);
    expect(result.verification.failures[0]).toContain(
      "Need 3 oracles but only 1 available",
    );
  });

  test("fails when no MultiOracleResolver is provided", async () => {
    const query = makeQuery({
      quorum: { min_approvals: 2 },
      oracle_ids: ["o1", "o2"],
    });
    const resolver = makeResolver({});

    const result = await verifyWithQuorum(query, makeResult(), resolver);

    expect(result.passed).toBe(false);
    expect(result.verification.failures[0]).toContain(
      "No oracle registry with resolveMultiple support",
    );
  });

  test("collects checks and failures from all oracles", async () => {
    const oracles = [
      makeMockOracle("o1", () => true),
      makeMockOracle("o2", () => false),
      makeMockOracle("o3", () => true),
    ];
    const query = makeQuery({
      quorum: { min_approvals: 2 },
      oracle_ids: ["o1", "o2", "o3"],
    });
    const resolver = makeResolver({});
    const multiResolver = makeMultiResolver(oracles);

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      multiResolver,
    );

    expect(result.passed).toBe(true);
    expect(result.verification.checks).toContain("o1 check passed");
    expect(result.verification.checks).toContain("o3 check passed");
    expect(result.verification.failures).toContain("o2 check failed");
  });

  test("attestation records include all oracle IDs", async () => {
    const oracles = [
      makeMockOracle("o1"),
      makeMockOracle("o2"),
    ];
    const query = makeQuery({
      quorum: { min_approvals: 1 },
      oracle_ids: ["o1", "o2"],
    });
    const resolver = makeResolver({});
    const multiResolver = makeMultiResolver(oracles);

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      multiResolver,
    );

    const oracleIds = result.attestations.map((a) => a.oracle_id);
    expect(oracleIds).toContain("o1");
    expect(oracleIds).toContain("o2");
  });

  test("quorum with oracle_ids filters to acceptable oracles only", async () => {
    const oracles = [
      makeMockOracle("trusted-1"),
      makeMockOracle("trusted-2"),
      makeMockOracle("untrusted"),
    ];
    const query = makeQuery({
      quorum: { min_approvals: 2 },
      oracle_ids: ["trusted-1", "trusted-2"],
    });
    const resolver = makeResolver({});
    const multiResolver = makeMultiResolver(oracles);

    const result = await verifyWithQuorum(
      query,
      makeResult(),
      resolver,
      multiResolver,
    );

    expect(result.passed).toBe(true);
    const ids = result.attestations.map((a) => a.oracle_id);
    expect(ids).not.toContain("untrusted");
  });

  test("resolves oracles independently (each verifies on its own)", async () => {
    const callLog: string[] = [];
    const oracles: Oracle[] = [
      {
        info: { id: "independent-1", name: "I1", fee_ppm: 0 },
        async verify(query) {
          callLog.push("independent-1");
          return {
            oracle_id: "independent-1",
            query_id: query.id,
            passed: true,
            checks: ["ok"],
            failures: [],
            attested_at: Date.now(),
          };
        },
      },
      {
        info: { id: "independent-2", name: "I2", fee_ppm: 0 },
        async verify(query) {
          callLog.push("independent-2");
          return {
            oracle_id: "independent-2",
            query_id: query.id,
            passed: true,
            checks: ["ok"],
            failures: [],
            attested_at: Date.now(),
          };
        },
      },
    ];
    const query = makeQuery({
      quorum: { min_approvals: 2 },
      oracle_ids: ["independent-1", "independent-2"],
    });
    const resolver = makeResolver({});
    const multiResolver = makeMultiResolver(oracles);

    await verifyWithQuorum(query, makeResult(), resolver, multiResolver);

    expect(callLog).toContain("independent-1");
    expect(callLog).toContain("independent-2");
    expect(callLog.length).toBe(2);
  });
});
