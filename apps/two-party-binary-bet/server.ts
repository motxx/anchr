/**
 * Standalone two-party binary bet server.
 *
 * Runs the two-party binary bet as an independent application,
 * separate from the Anchr protocol server.
 *
 * Usage:
 *   deno run --allow-all apps/two-party-binary-bet/server.ts
 *
 * With FROST threshold Oracle:
 *   FROST_MARKET_CONFIG_PATH=.frost-market/signer-1.json \
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   deno run --allow-all apps/two-party-binary-bet/server.ts
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/deno";
import type { MiddlewareHandler } from "hono";
import {
  createMarketState,
  getFaucetStatus,
  registerMarketRoutes,
  seedFaucetTokensFromEnv,
} from "./src/server-routes.ts";
import { startAutoResolver } from "./src/auto-resolver.ts";
import { openMarketStore } from "./src/market-store.ts";
import { isMintReachable } from "./src/market-wallet.ts";
import {
  type DualOutcomeFrostNodeConfig,
  loadDualOutcomeFrostNodeConfigAsync,
} from "@anchr/frost-oracle/dual-outcome-config";

const app = new Hono();
app.use("*", cors());

function clientIp(
  c: { req: { header(name: string): string | undefined } },
): string {
  return c.req.header("fly-client-ip") ??
    c.req.header("x-real-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
}

function createRateLimitMiddleware(): MiddlewareHandler {
  const windowMs = Number(
    Deno.env.get("MARKET_RATE_LIMIT_WINDOW_MS") ?? "60000",
  );
  const max = Number(Deno.env.get("MARKET_RATE_LIMIT_MAX") ?? "60");
  const buckets = new Map<string, { resetAt: number; count: number }>();
  return async (c, next) => {
    const now = Date.now();
    const key = clientIp(c);
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { resetAt: now + windowMs, count: 0 };
    bucket.count++;
    buckets.set(key, bucket);
    if (bucket.count > max) {
      return c.json(
        {
          error: "rate limit exceeded",
          retry_after_seconds: Math.ceil((bucket.resetAt - now) / 1000),
        },
        429,
      );
    }
    await next();
  };
}

function createSignerAuthMiddleware(): MiddlewareHandler {
  const apiKey = Deno.env.get("MARKET_SIGNER_API_KEY")?.trim() ||
    Deno.env.get("ORACLE_API_KEY")?.trim();
  return async (c, next) => {
    const supplied = c.req.header("x-api-key") ??
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (apiKey && supplied === apiKey) {
      await next();
      return;
    }
    const forwardedClient = c.req.header("fly-client-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (
      !forwardedClient || forwardedClient === "127.0.0.1" ||
      forwardedClient === "::1"
    ) {
      await next();
      return;
    }
    return c.json({ error: "Signer endpoint is internal" }, 403);
  };
}

const noopMiddleware: MiddlewareHandler = async (_c, next) => await next();
const rateLimitMiddleware = createRateLimitMiddleware();
const signerAuthMiddleware = createSignerAuthMiddleware();

// Optional FROST cluster config. Plaintext (dev) or AES-256-GCM-encrypted
// envelope (prod). The passphrase comes from FROST_KEY_PASSPHRASE.
let frostConfig: DualOutcomeFrostNodeConfig | undefined;
const frostConfigPath = Deno.env.get("FROST_MARKET_CONFIG_PATH");
if (frostConfigPath) {
  try {
    frostConfig = await loadDualOutcomeFrostNodeConfigAsync(frostConfigPath, {
      passphrase: Deno.env.get("FROST_KEY_PASSPHRASE"),
    });
    console.log(`[market] FROST market config loaded from ${frostConfigPath}`);
    console.log(
      `[market] FROST ${frostConfig.threshold}-of-${frostConfig.total_signers}`,
    );
  } catch (err) {
    console.error(
      `[market] failed to load FROST config: ${
        err instanceof Error ? err.message : err
      }`,
    );
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
  console.log(
    "[market] NOSTR_RELAYS not set — UI wallet uses localStorage only.",
  );
}

// Persistent state: SQLite at MARKET_DB_PATH (defaults to /data/market.db
// on Fly, or ./market.db locally). The same DB owns the matching queue and the
// runtime maps so a Fly machine restart recovers full market state.
const marketDbPath = Deno.env.get("MARKET_DB_PATH") ?? "./market.db";
const marketStore = openMarketStore({ path: marketDbPath });
const hydrated = await marketStore.hydrate();
console.log(`[market] market store opened at ${marketDbPath}`);

// Construct state explicitly so we can also hand it to the auto-resolver.
const state = createMarketState({
  frostConfig,
  nostrRelays,
  matchingQueue: marketStore.matchingQueue,
  initial: hydrated,
  persist: marketStore.persist,
  allowManualResolve: Deno.env.get("MARKET_ALLOW_MANUAL_RESOLVE") === "1",
});
const seededFaucetTokens = await seedFaucetTokensFromEnv(state);
if (seededFaucetTokens > 0) {
  console.log(
    `[market] seeded ${seededFaucetTokens} public-testnet faucet token(s)`,
  );
}

registerMarketRoutes(app, {
  writeAuth: noopMiddleware,
  rateLimit: rateLimitMiddleware,
  signerAuth: signerAuthMiddleware,
}, state);

app.get("/health", (c) => {
  const mintUrl = Deno.env.get("CASHU_MINT_URL") ?? null;
  return c.json({
    ok: true,
    app: "two-party-binary-bet",
    mode: state.frostMode,
    markets: state.markets.size,
    matched_pairs: state.matchedPairs.size,
    mint_url: mintUrl,
    nostr_relays: state.nostrRelays,
    faucet: getFaucetStatus(state, mintUrl),
  });
});

app.get("/ready", async (c) => {
  const mintUrl = Deno.env.get("CASHU_MINT_URL") ?? null;
  const faucet = getFaucetStatus(state, mintUrl);
  const checks = {
    mint_configured: Boolean(mintUrl),
    mint_reachable: mintUrl ? await isMintReachable(mintUrl) : false,
    nostr_configured: state.nostrRelays.length > 0,
    faucet_configured: faucet.enabled,
    persistence_open: true,
  };
  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const ok = missing.length === 0;
  return c.json({ ok, checks, missing, faucet }, ok ? 200 : 503);
});

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
    marketStore.close().catch(() => {});
    Deno.exit(0);
  });
}

// Serve UI static files
app.get(
  "/",
  serveStatic({ path: "./apps/two-party-binary-bet/ui/index.html" }),
);
app.get(
  "/generated.css",
  serveStatic({ path: "./apps/two-party-binary-bet/ui/generated.css" }),
);
app.get(
  "/main.js",
  serveStatic({ path: "./apps/two-party-binary-bet/ui/main.js" }),
);
app.get(
  "/main.js.map",
  serveStatic({ path: "./apps/two-party-binary-bet/ui/main.js.map" }),
);

// SPA catch-all — anything that isn't an API route or a known asset falls
// through to index.html so deep links like /m/<market-id> hydrate the React
// app. registerMarketRoutes mounts /markets/* before this, so API requests
// still take precedence.
app.get(
  "*",
  serveStatic({ path: "./apps/two-party-binary-bet/ui/index.html" }),
);

const port = Number(Deno.env.get("MARKET_PORT")) || 3001;
console.log(`Two-party binary bet server on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
