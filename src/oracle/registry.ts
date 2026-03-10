import { builtInOracle, BUILT_IN_ORACLE_ID } from "./built-in";
import type { Oracle, OracleInfo } from "./types";

const oracles = new Map<string, Oracle>();

// Register the built-in oracle by default
oracles.set(BUILT_IN_ORACLE_ID, builtInOracle);

export function getOracle(id: string): Oracle | null {
  return oracles.get(id) ?? null;
}

export function listOracles(): OracleInfo[] {
  return [...oracles.values()].map((o) => o.info);
}

export function registerOracle(oracle: Oracle): void {
  oracles.set(oracle.info.id, oracle);
}

export function resolveOracle(oracleId: string | undefined, acceptableIds: string[] | undefined): Oracle | null {
  // Explicit oracle_id from worker
  if (oracleId) {
    // Must be in acceptable set if one was specified
    if (acceptableIds?.length && !acceptableIds.includes(oracleId)) return null;
    return getOracle(oracleId);
  }
  // No explicit choice — use the only acceptable oracle, or fall back to built-in
  if (acceptableIds?.length === 1) return getOracle(acceptableIds[0]!);
  return getOracle(BUILT_IN_ORACLE_ID);
}
