#!/usr/bin/env -S deno run --allow-all
/**
 * FROST Market Oracle Node -- single Oracle server instance for prediction markets.
 *
 * Loads a MarketFrostNodeConfig and serves market API routes with FROST signing.
 * Launched by scripts/frost-market-oracle-cluster.ts.
 *
 * Environment variables:
 *   FROST_MARKET_CONFIG_PATH  Path to signer-N.json (required)
 *   ORACLE_PORT               Port to listen on (default: 4001)
 *   ORACLE_API_KEY             API key for peer auth (optional)
 *   ORACLE_ID                 Node identifier (optional)
 */

import { loadMarketFrostNodeConfig } from "../src/infrastructure/frost/market-frost-config.ts";
import { buildMarketApiRoutes } from "../example/prediction-market/src/market-api-routes.ts";

const ORACLE_ID = Deno.env.get("ORACLE_ID") ?? "market-oracle";
const ORACLE_PORT = Number(Deno.env.get("ORACLE_PORT")) || 4001;
const API_KEY = Deno.env.get("ORACLE_API_KEY")?.trim();
const FROST_CONFIG_PATH = Deno.env.get("FROST_MARKET_CONFIG_PATH")?.trim();

if (!FROST_CONFIG_PATH) {
  console.error("ERROR: FROST_MARKET_CONFIG_PATH environment variable is required");
  console.error("Run: deno run --allow-all scripts/frost-market-dkg-bootstrap.ts");
  Deno.exit(1);
}

try {
  const marketFrostConfig = loadMarketFrostNodeConfig(FROST_CONFIG_PATH);
  console.log(`[${ORACLE_ID}] Loaded FROST market config from ${FROST_CONFIG_PATH}`);
  console.log(`[${ORACLE_ID}] Signer ${marketFrostConfig.signer_index} of ${marketFrostConfig.total_signers} (threshold: ${marketFrostConfig.threshold})`);
  console.log(`[${ORACLE_ID}] YES group: ${marketFrostConfig.group_pubkey.slice(0, 16)}...`);
  console.log(`[${ORACLE_ID}] NO  group: ${marketFrostConfig.group_pubkey_no.slice(0, 16)}...`);

  const { app } = buildMarketApiRoutes({
    apiKey: API_KEY,
    marketFrostConfig,
    oracleFeePpm: 5_000,
  });

  console.log(`[${ORACLE_ID}] Starting on port ${ORACLE_PORT}`);
  Deno.serve({ port: ORACLE_PORT }, app.fetch);
} catch (e) {
  console.error(`[${ORACLE_ID}] Failed to start:`, e instanceof Error ? e.message : e);
  Deno.exit(1);
}
