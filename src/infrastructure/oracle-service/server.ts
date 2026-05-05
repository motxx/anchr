/**
 * Standalone oracle HTTP server.
 *
 * Runs the same deterministic verification as the built-in oracle but as
 * an independent HTTP service that workers contact directly. Tor-friendly:
 * stateless, no cookies, no identity tracking.
 *
 * Usage:
 *   ORACLE_PORT=4000 ORACLE_API_KEY=secret deno run src/infrastructure/oracle-service/server.ts
 *
 * Routes are split across sibling files; this module composes them onto a
 * single Hono app and owns process-level concerns (env, logging, listen).
 */

import { Hono } from "hono";
import { createPreimageStore, createPersistentPreimageStore, type PreimageStore } from "@anchr/core-cashu/preimage-store";
import { createFrostCoordinator, type FrostCoordinator } from "@anchr/frost-oracle/coordinator";
import type { ThresholdOracleConfig } from "@anchr/frost-oracle/types";
import type { FrostNodeConfig } from "@anchr/frost-oracle/config";
import { buildAuthMiddleware } from "./auth.ts";
import { registerHtlcRoutes } from "./htlc-routes.ts";
import { registerFrostSignerRoutes } from "./frost-signer-routes.ts";
import { registerFrostDkgRoutes } from "./frost-dkg-routes.ts";
import { registerFrostSignRoutes } from "./frost-sign-routes.ts";

import { getLogger } from "@anchr/core-runtime/logger";
const log = getLogger(["anchr", "oracle-server"]);

const ORACLE_ID = Deno.env.get("ORACLE_ID") ?? "remote-oracle";
const ORACLE_API_KEY = Deno.env.get("ORACLE_API_KEY")?.trim();
const ORACLE_PORT = Number(Deno.env.get("ORACLE_PORT")) || 4000;

export interface OracleAppOptions {
  oracleId?: string;
  apiKey?: string;
  preimageStore?: PreimageStore;
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
  const preimageStore = opts.preimageStore ?? createPreimageStore();
  const frostCoordinator = opts.frostCoordinator ?? createFrostCoordinator();
  const frostConfig = opts.frostConfig;
  const frostNodeConfig = opts.frostNodeConfig;

  const app = new Hono();
  const authMiddleware = buildAuthMiddleware(resolvedApiKey);

  app.get("/health", (c) => c.json({ ok: true, oracle_id: oracleId }));
  app.get("/info", (c) =>
    c.json({
      id: oracleId,
      name: `Oracle ${oracleId}`,
      fee_ppm: Number(Deno.env.get("ORACLE_FEE_PPM")) || 0,
    }),
  );

  // Per-app session state. Lives only as long as the app instance — the
  // route registrars hold references but never mutate the binding.
  const queryHashMap = new Map<string, string>();
  const verifiedQueries = new Map<string, string>();
  const pendingNonces = new Map<string, string>();

  registerHtlcRoutes(app, {
    oracleId,
    authMiddleware,
    preimageStore,
    queryHashMap,
    verifiedQueries,
  });

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
  const preimageDbPath = Deno.env.get("ORACLE_PREIMAGE_DB")?.trim();
  const preimageStore = preimageDbPath
    ? createPersistentPreimageStore(preimageDbPath)
    : undefined;

  let frostNodeConfig: FrostNodeConfig | undefined;
  let frostConfig: ThresholdOracleConfig | undefined;
  const frostConfigPath = Deno.env.get("FROST_CONFIG_PATH")?.trim();
  if (frostConfigPath) {
    try {
      const { loadFrostNodeConfig, toThresholdOracleConfig } = await import("@anchr/frost-oracle/config"); // allow-dynamic-import: deferred to avoid loading FROST config parser when FROST_CONFIG_PATH is unset
      frostNodeConfig = loadFrostNodeConfig(frostConfigPath);
      frostConfig = toThresholdOracleConfig(frostNodeConfig);
      log.info(`FROST ${frostNodeConfig.threshold}-of-${frostNodeConfig.total_signers} loaded (group_pubkey=${frostNodeConfig.group_pubkey.slice(0, 16)}...)`);
    } catch (e) {
      log.error(`Failed to load FROST config from ${frostConfigPath}:`, e);
    }
  }

  const app = buildOracleApp({
    oracleId: ORACLE_ID,
    apiKey: ORACLE_API_KEY,
    preimageStore,
    frostCoordinator: frostConfig ? createFrostCoordinator() : undefined,
    frostConfig,
    frostNodeConfig,
  });

  if (preimageDbPath) {
    log.info(`Preimage store persisted to ${preimageDbPath}`);
  }
  log.info(`Starting oracle "${ORACLE_ID}" on port ${ORACLE_PORT}`);

  Deno.serve({ port: ORACLE_PORT }, app.fetch);
}
