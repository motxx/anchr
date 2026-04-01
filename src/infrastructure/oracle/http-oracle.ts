/**
 * HTTP oracle client — wraps a remote oracle's HTTP `/verify` endpoint
 * as an Oracle interface so it can be used seamlessly in the registry.
 */

import type { BlossomKeyMap, Query, QueryResult } from "../../domain/types";
import type { Oracle, OracleAttestation, OracleInfo } from "./types";

export interface HttpOracleConfig {
  id: string;
  name: string;
  endpoint: string;
  fee_ppm: number;
  /** Optional bearer token for authentication. */
  apiKey?: string;
  /** Request timeout in milliseconds (default: 30_000). */
  timeoutMs?: number;
}

/**
 * Create an Oracle implementation that delegates verification to a remote HTTP service.
 *
 * The remote service must expose `POST /verify` accepting:
 *   { query: Query, result: QueryResult }
 * and returning:
 *   OracleAttestation
 */
export function createHttpOracle(config: HttpOracleConfig): Oracle {
  const info: OracleInfo = {
    id: config.id,
    name: config.name,
    endpoint: config.endpoint,
    fee_ppm: config.fee_ppm,
  };

  return {
    info,
    async verify(query: Query, result: QueryResult, blossomKeys?: BlossomKeyMap): Promise<OracleAttestation> {
      const url = `${config.endpoint.replace(/\/+$/, "")}/verify`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (config.apiKey) {
        headers["authorization"] = `Bearer ${config.apiKey}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, result, blossom_keys: blossomKeys }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`Oracle ${config.id} returned ${response.status}: ${text}`);
        }

        const attestation = (await response.json()) as OracleAttestation;

        // Ensure the attestation has required fields
        if (typeof attestation.passed !== "boolean" || !Array.isArray(attestation.checks)) {
          throw new Error(`Oracle ${config.id} returned malformed attestation`);
        }

        return {
          oracle_id: config.id,
          query_id: query.id,
          passed: attestation.passed,
          checks: attestation.checks,
          failures: attestation.failures ?? [],
          attested_at: attestation.attested_at ?? Date.now(),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
