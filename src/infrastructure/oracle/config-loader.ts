/**
 * Oracle configuration loader — registers oracles from ORACLE_REGISTRY env var.
 *
 * Format: id:endpoint:fee_ppm[:apikey],id2:endpoint2:fee_ppm2[:apikey2],...
 *
 * Example:
 *   ORACLE_REGISTRY=ext1:https://oracle1.example.com:50000:sk-xxx,ext2:https://oracle2.example.com:30000
 */

import { createHttpOracle } from "./http-oracle";
import type { OracleRegistry } from "./registry";

export interface OracleConfigEntry {
  id: string;
  endpoint: string;
  fee_ppm: number;
  apiKey?: string;
}

/**
 * Parse the ORACLE_REGISTRY env var into config entries.
 */
export function parseOracleRegistry(raw: string): OracleConfigEntry[] {
  const results: OracleConfigEntry[] = [];
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);

  for (const entry of entries) {
    const parts = entry.split(":");
    if (parts.length < 3) {
      console.error(`[oracle-config] Invalid entry (need id:endpoint:fee_ppm): ${entry}`);
      continue;
    }

    const id = parts[0]!;
    const lastPart = parts[parts.length - 1]!;

    let endpoint: string;
    let fee_ppm: number;
    let apiKey: string | undefined;

    if (/^\d+$/.test(lastPart)) {
      // No API key: id:endpoint:fee_ppm
      fee_ppm = Number(lastPart);
      endpoint = parts.slice(1, -1).join(":");
    } else {
      // API key present (may contain colons). Scan backwards for fee_ppm.
      let feeIdx = -1;
      for (let i = parts.length - 2; i >= 2; i--) {
        if (/^\d+$/.test(parts[i]!)) {
          feeIdx = i;
          break;
        }
      }
      if (feeIdx === -1) {
        console.error(`[oracle-config] Cannot parse fee_ppm in entry: ${entry}`);
        continue;
      }
      fee_ppm = Number(parts[feeIdx]!);
      endpoint = parts.slice(1, feeIdx).join(":");
      apiKey = parts.slice(feeIdx + 1).join(":");
    }

    results.push({ id, endpoint, fee_ppm, apiKey });
  }

  return results;
}

/**
 * Load oracles from ORACLE_REGISTRY env var and register them.
 * Called at application startup.
 */
export function loadOraclesFromEnv(registry: OracleRegistry): number {
  const raw = process.env.ORACLE_REGISTRY?.trim();
  if (!raw) return 0;

  const entries = parseOracleRegistry(raw);
  for (const entry of entries) {
    const oracle = createHttpOracle({
      id: entry.id,
      name: `External Oracle: ${entry.id}`,
      endpoint: entry.endpoint,
      fee_ppm: entry.fee_ppm,
      apiKey: entry.apiKey,
    });
    registry.register(oracle);
    console.error(`[oracle-config] Registered oracle: ${entry.id} at ${entry.endpoint}`);
  }

  return entries.length;
}
