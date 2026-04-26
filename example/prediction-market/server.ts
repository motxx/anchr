/**
 * Standalone Prediction Market server.
 *
 * Runs the prediction market as an independent application,
 * separate from the Anchr protocol server.
 *
 * Usage:
 *   deno run --allow-all example/prediction-market/server.ts
 *
 * With FROST threshold Oracle:
 *   FROST_MARKET_CONFIG_PATH=.frost-market/signer-1.json \
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   deno run --allow-all example/prediction-market/server.ts
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/deno";
import type { MiddlewareHandler } from "hono";
import { createMarketState, registerMarketRoutes } from "./src/server-routes.ts";
import { startAutoResolver } from "./src/auto-resolver.ts";
import {
  loadMarketFrostNodeConfigAsync,
  type MarketFrostNodeConfig,
} from "@anchr/cashu-frost-oracle/market-frost-config";

const app = new Hono();
app.use("*", cors());

// No auth for demo — production should add API key middleware
const noopMiddleware: MiddlewareHandler = async (_c, next) => await next();

// Optional FROST cluster config. Plaintext (dev) or AES-256-GCM-encrypted
// envelope (prod). The passphrase comes from FROST_KEY_PASSPHRASE.
let frostConfig: MarketFrostNodeConfig | undefined;
const frostConfigPath = Deno.env.get("FROST_MARKET_CONFIG_PATH");
if (frostConfigPath) {
  try {
    frostConfig = await loadMarketFrostNodeConfigAsync(frostConfigPath, {
      passphrase: Deno.env.get("FROST_KEY_PASSPHRASE"),
    });
    console.log(`[market] FROST market config loaded from ${frostConfigPath}`);
    console.log(`[market] FROST ${frostConfig.threshold}-of-${frostConfig.total_signers}`);
  } catch (err) {
    console.error(`[market] failed to load FROST config: ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }
}

// Construct state explicitly so we can also hand it to the auto-resolver.
const state = createMarketState({ frostConfig });

registerMarketRoutes(app, {
  writeAuth: noopMiddleware,
  rateLimit: noopMiddleware,
}, state);

// Background scheduler — resolves markets once their deadline has passed.
// Disable with AUTO_RESOLVE_DISABLED=1 (e.g. for tests / dev that want to
// drive resolution manually).
if (Deno.env.get("AUTO_RESOLVE_DISABLED") !== "1") {
  const pollMs = Number(Deno.env.get("AUTO_RESOLVE_POLL_MS")) || 30_000;
  const handle = startAutoResolver(state, { pollIntervalMs: pollMs });
  console.log(`[market] auto-resolver started (poll=${pollMs}ms)`);
  // Stop on SIGINT so the scheduler doesn't keep the process alive.
  Deno.addSignalListener("SIGINT", () => {
    handle.stop();
    Deno.exit(0);
  });
}

// Serve UI static files
app.get("/", serveStatic({ path: "./example/prediction-market/ui/index.html" }));
app.get("/generated.css", serveStatic({ path: "./example/prediction-market/ui/generated.css" }));
app.get("/main.js", serveStatic({ path: "./example/prediction-market/ui/main.js" }));
app.get("/main.js.map", serveStatic({ path: "./example/prediction-market/ui/main.js.map" }));

const port = Number(Deno.env.get("MARKET_PORT")) || 3001;
console.log(`Prediction Market server on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
