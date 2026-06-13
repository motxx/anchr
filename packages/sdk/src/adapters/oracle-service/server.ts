/**
 * FROST peer endpoint server.
 *
 * Hosts Oracle-to-Oracle DKG, coordinator signing, and signer round endpoints.
 * The Customer/Provider/Oracle exchange is relay-owned by the Nostr adapter.
 */

import { Hono } from "hono";
import {
  createFrostCoordinator,
  type FrostCoordinator,
} from "../../payments/mod.ts";
import type { ThresholdOracleConfig } from "../../payments/mod.ts";
import type { FrostNodeConfig } from "../../payments/mod.ts";
import { buildAuthMiddleware } from "./auth.ts";
import {
  type PendingNonceSession,
  registerFrostSignerRoutes,
} from "./frost-signer-routes.ts";
import { registerFrostDkgRoutes } from "./frost-dkg-routes.ts";
import { registerFrostSignRoutes } from "./frost-sign-routes.ts";

import { getLogger } from "../../internal/runtime/logger.ts";
const log = getLogger(["anchr", "oracle-server"]);

const ORACLE_ID = Deno.env.get("ORACLE_ID") ?? "remote-oracle";
const ORACLE_API_KEY = Deno.env.get("ORACLE_API_KEY")?.trim();
const ORACLE_PORT = Number(Deno.env.get("ORACLE_PORT")) || 4000;

export interface OracleAppOptions {
  oracleId?: string;
  apiKey?: string;
  /** FROST coordinator for threshold signing. */
  frostCoordinator?: FrostCoordinator;
  /** FROST threshold oracle config (coordinator side). */
  frostConfig?: ThresholdOracleConfig;
  /** Per-node FROST config (loaded from DKG-generated JSON). */
  frostNodeConfig?: FrostNodeConfig;
}

export function buildOracleApp(
  oracleIdOrOptions?: string | OracleAppOptions,
  apiKey?: string,
): Hono {
  const opts: OracleAppOptions = typeof oracleIdOrOptions === "string"
    ? { oracleId: oracleIdOrOptions, apiKey }
    : oracleIdOrOptions ?? {};

  const oracleId = opts.oracleId ?? ORACLE_ID;
  const resolvedApiKey = opts.apiKey ?? apiKey;
  const frostCoordinator = opts.frostCoordinator ?? createFrostCoordinator();
  const frostConfig = opts.frostConfig;
  const frostNodeConfig = opts.frostNodeConfig;

  const app = new Hono();
  const authMiddleware = buildAuthMiddleware(resolvedApiKey);

  app.get("/health", (c) => c.json({ ok: true, oracle_id: oracleId }));
  app.get("/info", (c) =>
    c.json({
      id: oracleId,
      name: `FROST Oracle ${oracleId}`,
      fee_ppm: Number(Deno.env.get("ORACLE_FEE_PPM")) || 0,
    }));

  const pendingNonces = new Map<string, PendingNonceSession>();

  registerFrostSignerRoutes(app, {
    authMiddleware,
    frostNodeConfig,
    pendingNonces,
  });

  registerFrostDkgRoutes(app, {
    authMiddleware,
    frostCoordinator,
  });

  registerFrostSignRoutes(app, {
    authMiddleware,
    frostCoordinator,
    frostConfig,
  });

  return app;
}

if (import.meta.main) {
  let frostNodeConfig: FrostNodeConfig | undefined;
  let frostConfig: ThresholdOracleConfig | undefined;
  const frostConfigPath = Deno.env.get("FROST_CONFIG_PATH")?.trim();
  if (frostConfigPath) {
    try {
      const { loadFrostNodeConfig, toThresholdOracleConfig } = await import(
        "../../payments/mod.ts"
      ); // allow-dynamic-import: deferred to avoid loading FROST config parser when FROST_CONFIG_PATH is unset
      frostNodeConfig = loadFrostNodeConfig(frostConfigPath);
      frostConfig = toThresholdOracleConfig(frostNodeConfig);
      log.info(
        `FROST ${frostNodeConfig.threshold}-of-${frostNodeConfig.total_signers} loaded (group_pubkey=${
          frostNodeConfig.group_pubkey.slice(0, 16)
        }...)`,
      );
    } catch (e) {
      log.error(`Failed to load FROST config from ${frostConfigPath}:`, e);
    }
  }

  const app = buildOracleApp({
    oracleId: ORACLE_ID,
    apiKey: ORACLE_API_KEY,
    frostCoordinator: frostConfig ? createFrostCoordinator() : undefined,
    frostConfig,
    frostNodeConfig,
  });

  log.info(`Starting FROST oracle "${ORACLE_ID}" on port ${ORACLE_PORT}`);

  Deno.serve({ port: ORACLE_PORT }, app.fetch);
}
