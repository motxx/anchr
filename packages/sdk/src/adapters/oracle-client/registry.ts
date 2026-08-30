import type { Oracle } from "../../requests/domain/oracle-types.ts";
import type { OracleRegistry } from "../../requests/application/ports.ts";
export type { OracleRegistry } from "../../requests/application/ports.ts";

export function createOracleRegistry(): OracleRegistry {
  const oracles = new Map<string, Oracle>();

  const registry: OracleRegistry = {
    get(id) {
      return oracles.get(id) ?? null;
    },
    list() {
      return [...oracles.values()].map((o) => o.info);
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
      return null;
    },
    resolveMultiple(acceptableIds, count) {
      const result: Oracle[] = [];
      if (acceptableIds?.length) {
        for (const id of acceptableIds) {
          if (result.length >= count) break;
          const o = oracles.get(id);
          if (o) result.push(o);
        }
      } else {
        for (const o of oracles.values()) {
          if (result.length >= count) break;
          result.push(o);
        }
      }
      return result;
    },
  };

  return registry;
}
