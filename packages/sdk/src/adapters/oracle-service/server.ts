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

export interface OracleAppOptions {
  oracleId?: string;
  apiKey?: string;
  feePpm?: number;
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

  const oracleId = opts.oracleId ?? "remote-oracle";
  const resolvedApiKey = opts.apiKey ?? apiKey;
  const feePpm = opts.feePpm ?? 0;
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
      fee_ppm: feePpm,
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
