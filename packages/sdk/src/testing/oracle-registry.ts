import type {
  Oracle,
  OracleAttestation,
  OracleInfo,
} from "../requests/domain/oracle-types.ts";
import type { OracleRegistry } from "../requests/application/ports.ts";
import type { Query, QueryResult } from "../requests/domain/types.ts";

const BUILT_IN_ORACLE_ID = "built-in";

const builtInOracle: Oracle = {
  info: {
    id: BUILT_IN_ORACLE_ID,
    name: "Built-in test oracle",
    fee_ppm: 0,
  },
  verify(query: Query, _result: QueryResult) {
    return Promise.resolve({
      oracle_id: BUILT_IN_ORACLE_ID,
      query_id: query.id,
      passed: true,
      checks: ["accepted by built-in test oracle"],
      failures: [],
      attested_at: Date.now(),
    });
  },
};

export function createOracleRegistry(
  options?: { skipBuiltIn?: boolean },
): OracleRegistry {
  const oracles = new Map<string, Oracle>();
  if (!options?.skipBuiltIn) {
    oracles.set(BUILT_IN_ORACLE_ID, builtInOracle);
  }

  const registry: OracleRegistry = {
    get(id) {
      return oracles.get(id) ?? null;
    },
    list() {
      return [...oracles.values()].map((oracle): OracleInfo => oracle.info);
    },
    register(oracle) {
      oracles.set(oracle.info.id, oracle);
    },
    resolve(oracleId, acceptableIds) {
      if (oracleId) {
        if (acceptableIds?.length && !acceptableIds.includes(oracleId)) {
          return null;
        }
        return registry.get(oracleId);
      }
      if (acceptableIds?.length === 1) return registry.get(acceptableIds[0]!);
      return registry.get(BUILT_IN_ORACLE_ID);
    },
    resolveMultiple(acceptableIds, count) {
      const result: Oracle[] = [];
      const candidates = acceptableIds?.length
        ? acceptableIds.map((id) => oracles.get(id)).filter((oracle) =>
          oracle !== undefined
        )
        : [...oracles.values()];

      for (const oracle of candidates) {
        if (result.length >= count) break;
        result.push(oracle);
      }
      return result;
    },
  };

  return registry;
}

export type { Oracle, OracleAttestation, OracleRegistry };
