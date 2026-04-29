/**
 * Standalone 巫(Kannagi) prediction market server.
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
  createPostgresOrderBook,
  type PostgresOrderBook,
} from "./src/order-book-postgres.ts";
import type { OrderBook } from "./src/order-book.ts";
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

// Resolve Nostr relay set from env so the wallet/config endpoint can hand
// it to the browser-side NIP-60 client. Comma-separated list of ws(s)://
// URLs; empty/unset disables NIP-60 persistence and falls the UI back to
// localStorage.
function resolveNostrRelaysFromEnv(): string[] {
  const raw = Deno.env.get("NOSTR_RELAYS")?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => {
      if (!url) return false;
      try {
        const parsed = new URL(url);
        return parsed.protocol === "ws:" || parsed.protocol === "wss:";
      } catch {
        return false;
      }
    });
}
const nostrRelays = resolveNostrRelaysFromEnv();
if (nostrRelays.length > 0) {
  console.log(`[market] NIP-60 wallet relays: ${nostrRelays.join(", ")}`);
} else {
  console.log("[market] NOSTR_RELAYS not set — UI wallet uses localStorage only.");
}

// Order book backend: durable Postgres if DATABASE_URL is set, otherwise
// in-memory (good for tests/dev, but open orders are lost on restart).
let orderBook: OrderBook | undefined;
let orderBookCloser: (() => Promise<void>) | undefined;
const databaseUrl = Deno.env.get("DATABASE_URL");
if (databaseUrl) {
  const pgOb: PostgresOrderBook = await createPostgresOrderBook({
    connectionUrl: databaseUrl,
    maxConnections: Number(Deno.env.get("DATABASE_POOL_SIZE")) || 10,
  });
  orderBook = pgOb;
  orderBookCloser = () => pgOb.close();
  console.log("[market] order book: Postgres (DATABASE_URL set)");
} else {
  console.log("[market] order book: in-memory (set DATABASE_URL to persist)");
}

// Construct state explicitly so we can also hand it to the auto-resolver.
const state = createMarketState({ frostConfig, nostrRelays, orderBook });

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
    if (orderBookCloser) {
      orderBookCloser().catch(() => {});
    }
    Deno.exit(0);
  });
}

// Serve UI static files
app.get("/", serveStatic({ path: "./example/prediction-market/ui/index.html" }));
app.get("/generated.css", serveStatic({ path: "./example/prediction-market/ui/generated.css" }));
app.get("/main.js", serveStatic({ path: "./example/prediction-market/ui/main.js" }));
app.get("/main.js.map", serveStatic({ path: "./example/prediction-market/ui/main.js.map" }));

// SPA catch-all — anything that isn't an API route or a known asset falls
// through to index.html so deep links like /m/<market-id> hydrate the React
// app. registerMarketRoutes mounts /markets/* before this, so API requests
// still take precedence.
app.get("*", serveStatic({ path: "./example/prediction-market/ui/index.html" }));

const port = Number(Deno.env.get("MARKET_PORT")) || 3001;
console.log(`巫(Kannagi) prediction market server on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
