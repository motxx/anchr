/**
 * FROST peer endpoint process entrypoint.
 */

import { buildOracleApp } from "./server.ts";
import {
  createFrostCoordinator,
  type FrostNodeConfig,
  loadFrostNodeConfig,
  type ThresholdOracleConfig,
  toThresholdOracleConfig,
} from "../../payments/mod.ts";
import { getLogger } from "../../internal/runtime/logger.ts";

const log = getLogger(["anchr", "oracle-server"]);

const ORACLE_ID = Deno.env.get("ORACLE_ID") ?? "remote-oracle";
const ORACLE_API_KEY = Deno.env.get("ORACLE_API_KEY")?.trim();
const ORACLE_PORT = Number(Deno.env.get("ORACLE_PORT")) || 4000;
const ORACLE_FEE_PPM = Number(Deno.env.get("ORACLE_FEE_PPM")) || 0;
const FROST_CONFIG_PATH = Deno.env.get("FROST_CONFIG_PATH")?.trim();

let frostNodeConfig: FrostNodeConfig | undefined;
let frostConfig: ThresholdOracleConfig | undefined;

if (FROST_CONFIG_PATH) {
  try {
    frostNodeConfig = loadFrostNodeConfig(FROST_CONFIG_PATH);
    frostConfig = toThresholdOracleConfig(frostNodeConfig);
    log.info(
      `FROST ${frostNodeConfig.threshold}-of-${frostNodeConfig.total_signers} loaded (group_pubkey=${
        frostNodeConfig.group_pubkey.slice(0, 16)
      }...)`,
    );
  } catch (e) {
    log.error(`Failed to load FROST config from ${FROST_CONFIG_PATH}:`, e);
  }
}

const app = buildOracleApp({
  oracleId: ORACLE_ID,
  apiKey: ORACLE_API_KEY,
  feePpm: ORACLE_FEE_PPM,
  frostCoordinator: frostConfig ? createFrostCoordinator() : undefined,
  frostConfig,
  frostNodeConfig,
});

log.info(`Starting FROST oracle "${ORACLE_ID}" on port ${ORACLE_PORT}`);

Deno.serve({ port: ORACLE_PORT }, app.fetch);
