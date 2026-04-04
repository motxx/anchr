import { builtInOracle, BUILT_IN_ORACLE_ID } from "./built-in";
import type { Oracle, OracleInfo } from "./types";

export interface OracleRegistry {
  get(id: string): Oracle | null;
  list(): OracleInfo[];
  register(oracle: Oracle): void;
  resolve(oracleId: string | undefined, acceptableIds: string[] | undefined): Oracle | null;
  /** Resolve up to `count` oracles from the acceptable set (for quorum). */
  resolveMultiple(acceptableIds: string[] | undefined, count: number): Oracle[];
}

export function createOracleRegistry(options?: { skipBuiltIn?: boolean }): OracleRegistry {
  const oracles = new Map<string, Oracle>();
  if (!options?.skipBuiltIn) {
    oracles.set(BUILT_IN_ORACLE_ID, builtInOracle);
  }

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
        if (acceptableIds?.length && !acceptableIds.includes(oracleId)) return null;
        return registry.get(oracleId);
      }
      if (acceptableIds?.length === 1) return registry.get(acceptableIds[0]!);
      return registry.get(BUILT_IN_ORACLE_ID);
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

// --- Default singleton (backward compat) ---

const defaultRegistry = createOracleRegistry();

export function getOracle(id: string): Oracle | null {
  return defaultRegistry.get(id);
}

export function listOracles(): OracleInfo[] {
  return defaultRegistry.list();
}

export function registerOracle(oracle: Oracle): void {
  defaultRegistry.register(oracle);
}

export function resolveOracle(oracleId: string | undefined, acceptableIds: string[] | undefined): Oracle | null {
  return defaultRegistry.resolve(oracleId, acceptableIds);
}
