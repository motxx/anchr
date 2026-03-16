import { builtInOracle, BUILT_IN_ORACLE_ID } from "./built-in";
import type { Oracle, OracleInfo } from "./types";

export interface OracleRegistry {
  get(id: string): Oracle | null;
  list(): OracleInfo[];
  register(oracle: Oracle): void;
  resolve(oracleId: string | undefined, acceptableIds: string[] | undefined): Oracle | null;
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
