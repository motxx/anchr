/**
 * Tests for market-api-routes.ts — prediction market HTTP endpoints.
 *
 * Uses buildWorkerApiApp() with injected MarketState for full isolation
 * between tests. No Cashu mint required (demo mode).
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  registerMarketRoutes,
  createMarketState,
  type MarketState,
  type MarketRouteContext,
} from "./market-api-routes.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** No-op middleware that always passes (open auth for testing). */
const noopMiddleware: MiddlewareHandler = async (_c, next) => {
  await next();
};

/** Build an isolated Hono app with fresh market state. */
function makeTestApp(stateOverrides?: Partial<MarketState>) {
  const state = createMarketState();
  if (stateOverrides) {
    Object.assign(state, stateOverrides);
  }
  const app = new Hono();
  const ctx: MarketRouteContext = {
    writeAuth: noopMiddleware,
    rateLimit: noopMiddleware,
  };
  registerMarketRoutes(app, ctx, state);
  return { app, state };
}

/** Shorthand for JSON POST. */
function jsonPost(
  app: ReturnType<typeof makeTestApp>["app"],
  path: string,
  body: unknown,
) {
  return app.request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Shorthand for JSON GET. */
function jsonGet(
  app: ReturnType<typeof makeTestApp>["app"],
  path: string,
) {
  return app.request(`http://localhost${path}`);
}

/** Valid market creation payload. */
function validMarketBody(overrides?: Record<string, unknown>) {
  return {
    title: "Will BTC hit 100k?",
    description: "Test market",
    category: "crypto",
    resolution_url: "https://api.example.com/price",
    resolution_deadline: Math.floor(Date.now() / 1000) + 86400,
    resolution_condition: {
      type: "price_above",
      target_url: "https://api.example.com/price",
      threshold: 100000,
      description: "BTC > 100k",
    },
    min_bet_sats: 10,
    creator_pubkey: "creator_abc",
    oracle_pubkey: "oracle_xyz",
    ...overrides,
  };
}

/** Create a market via the API and return its id + full response body. */
async function createMarket(
  app: ReturnType<typeof makeTestApp>["app"],
  overrides?: Record<string, unknown>,
) {
  const res = await jsonPost(app, "/markets", validMarketBody(overrides));
  expect(res.status).toBe(201);
  const body = await res.json() as { id: string; [k: string]: unknown };
  return body;
}

// ---------------------------------------------------------------------------
// Market CRUD
// ---------------------------------------------------------------------------

describe("Market CRUD", () => {
  test("POST /markets creates market with group pubkeys", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    expect(market.id).toMatch(/^mkt_/);
    expect(market.title).toBe("Will BTC hit 100k?");
    expect(market.category).toBe("crypto");
    expect(market.status).toBe("open");
    expect(market.yes_pool_sats).toBe(0);
    expect(market.no_pool_sats).toBe(0);
    // FROST P2PK group pubkeys should be set (single-key demo mode)
    expect(market.group_pubkey_yes).toBeTruthy();
    expect(market.group_pubkey_no).toBeTruthy();
    // HTLC hashes should also be set (dual-preimage fallback)
    expect(market.htlc_hash_yes).toBeTruthy();
    expect(market.htlc_hash_no).toBeTruthy();
  });

  test("GET /markets lists markets", async () => {
    const { app } = makeTestApp();
    await createMarket(app, { title: "Market 1" });
    await createMarket(app, { title: "Market 2" });

    const res = await jsonGet(app, "/markets");
    expect(res.status).toBe(200);
    const list = await res.json() as Array<{ title: string }>;
    expect(list).toHaveLength(2);
  });

  test("GET /markets?category= filters by category", async () => {
    const { app } = makeTestApp();
    await createMarket(app, { title: "Crypto market", category: "crypto" });
    await createMarket(app, { title: "Sports market", category: "sports" });

    const res = await jsonGet(app, "/markets?category=sports");
    expect(res.status).toBe(200);
    const list = await res.json() as Array<{ title: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Sports market");
  });

  test("GET /markets/:id returns market detail", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    const res = await jsonGet(app, `/markets/${market.id}`);
    expect(res.status).toBe(200);
    const detail = await res.json() as { id: string; title: string; open_orders: number; matched_pairs: number };
    expect(detail.id).toBe(market.id);
    expect(detail.title).toBe("Will BTC hit 100k?");
    expect(detail.open_orders).toBe(0);
    expect(detail.matched_pairs).toBe(0);
  });

  test("GET /markets/:id returns 404 for unknown market", async () => {
    const { app } = makeTestApp();
    const res = await jsonGet(app, "/markets/mkt_nonexistent");
    expect(res.status).toBe(404);
  });

  test("POST /markets with missing title returns 400", async () => {
    const { app } = makeTestApp();
    const res = await jsonPost(app, "/markets", {
      ...validMarketBody(),
      title: "",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("title");
  });

  test("POST /markets with missing resolution_url returns 400", async () => {
    const { app } = makeTestApp();
    const res = await jsonPost(app, "/markets", {
      ...validMarketBody(),
      resolution_url: "",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("resolution_url");
  });

  test("POST /markets with missing resolution_deadline returns 400", async () => {
    const { app } = makeTestApp();
    const res = await jsonPost(app, "/markets", {
      ...validMarketBody(),
      resolution_deadline: 0,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("resolution_deadline");
  });

  test("POST /markets with invalid category returns 400", async () => {
    const { app } = makeTestApp();
    const res = await jsonPost(app, "/markets", {
      ...validMarketBody(),
      category: "invalid_category",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("category");
  });
});

// ---------------------------------------------------------------------------
// Betting
// ---------------------------------------------------------------------------

describe("Betting", () => {
  test("POST /markets/:id/bet places YES bet", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    const res = await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes",
      amount_sats: 100,
      bettor_pubkey: "alice",
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      order_id: string;
      side: string;
      amount_sats: number;
      market: { yes_pool_sats: number; no_pool_sats: number };
    };
    expect(body.order_id).toMatch(/^ord_/);
    expect(body.side).toBe("yes");
    expect(body.amount_sats).toBe(100);
    expect(body.market.yes_pool_sats).toBe(100);
    expect(body.market.no_pool_sats).toBe(0);
  });

  test("POST /markets/:id/bet places NO bet and triggers matching", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    // Place YES bet first
    await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes",
      amount_sats: 100,
      bettor_pubkey: "alice",
    });

    // Place NO bet — should match with YES
    const res = await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "no",
      amount_sats: 100,
      bettor_pubkey: "bob",
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      matches: Array<{ pair_id: string; amount_sats: number; status: string }>;
      market: { yes_pool_sats: number; no_pool_sats: number };
    };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].amount_sats).toBe(100);
    expect(body.matches[0].pair_id).toMatch(/^pair_/);
    expect(body.market.yes_pool_sats).toBe(100);
    expect(body.market.no_pool_sats).toBe(100);
  });

  test("POST /markets/:id/bet validates min_bet_sats", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app, { min_bet_sats: 50 });

    const res = await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes",
      amount_sats: 10,
      bettor_pubkey: "alice",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Minimum bet");
  });

  test("POST /markets/:id/bet on closed market returns 409", async () => {
    const { app, state } = makeTestApp();
    const market = await createMarket(app);

    // Manually close the market
    const m = state.markets.get(market.id as string)!;
    m.status = "resolved_yes";

    const res = await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes",
      amount_sats: 100,
      bettor_pubkey: "alice",
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("not open");
  });

  test("POST /markets/:id/bet with invalid side returns 400", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    const res = await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "maybe",
      amount_sats: 100,
      bettor_pubkey: "alice",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("side");
  });

  test("POST /markets/:id/bet with zero amount returns 400", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    const res = await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes",
      amount_sats: 0,
      bettor_pubkey: "alice",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("positive");
  });

  test("POST /markets/:id/bet on nonexistent market returns 404", async () => {
    const { app } = makeTestApp();
    const res = await jsonPost(app, "/markets/mkt_fake/bet", {
      side: "yes",
      amount_sats: 100,
      bettor_pubkey: "alice",
    });
    expect(res.status).toBe(404);
  });

  test("POST /markets/:id/bet validates max_bet_sats", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app, { max_bet_sats: 500 });

    const res = await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes",
      amount_sats: 1000,
      bettor_pubkey: "alice",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Maximum bet");
  });

  test("partial matching works with different bet sizes", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    // YES bet for 200
    await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes",
      amount_sats: 200,
      bettor_pubkey: "alice",
    });

    // NO bet for 100 — should partially match
    const res = await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "no",
      amount_sats: 100,
      bettor_pubkey: "bob",
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      matches: Array<{ amount_sats: number }>;
    };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].amount_sats).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe("Resolution", () => {
  test("POST /markets/:id/resolve resolves market (single-key mode)", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    // Place matching bets
    await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes", amount_sats: 100, bettor_pubkey: "alice",
    });
    await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "no", amount_sats: 100, bettor_pubkey: "bob",
    });

    const res = await jsonPost(app, `/markets/${market.id}/resolve`, {
      outcome: "yes",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      market_id: string;
      outcome: string;
      status: string;
      mode: string;
      settled_pairs: Array<{ winner_pubkey: string }>;
    };
    expect(body.market_id).toBe(market.id);
    expect(body.outcome).toBe("yes");
    expect(body.status).toBe("resolved_yes");
    // Single-key mode uses FROST P2PK (demo single-key signing)
    expect(body.mode).toBe("frost_p2pk");
  });

  test("POST /markets/:id/resolve returns oracle_signature", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    const res = await jsonPost(app, `/markets/${market.id}/resolve`, {
      outcome: "no",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      oracle_signature?: string;
      status: string;
    };
    // In single-key mode, oracle_signature should be present
    expect(body.oracle_signature).toBeTruthy();
    expect(body.status).toBe("resolved_no");
  });

  test("POST /markets/:id/resolve double-resolve returns error", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    // First resolution
    const res1 = await jsonPost(app, `/markets/${market.id}/resolve`, {
      outcome: "yes",
    });
    expect(res1.status).toBe(200);

    // Second resolution should fail
    const res2 = await jsonPost(app, `/markets/${market.id}/resolve`, {
      outcome: "no",
    });
    expect(res2.status).toBe(409);
    const body = await res2.json() as { error: string };
    expect(body.error).toContain("cannot be resolved");
  });

  test("POST /markets/:id/resolve with invalid outcome returns 400", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    const res = await jsonPost(app, `/markets/${market.id}/resolve`, {
      outcome: "maybe",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("outcome");
  });

  test("POST /markets/:id/resolve on unknown market returns 404", async () => {
    const { app } = makeTestApp();
    const res = await jsonPost(app, "/markets/mkt_fake/resolve", {
      outcome: "yes",
    });
    expect(res.status).toBe(404);
  });

  test("resolved market updates settled pairs with winner", async () => {
    const { app, state } = makeTestApp();
    const market = await createMarket(app);

    // Inject a matched pair directly so yes/no pubkeys are distinct
    state.matchedPairs.set("pair_test1", {
      pair_id: "pair_test1",
      market_id: market.id as string,
      yes_pubkey: "alice",
      no_pubkey: "bob",
      amount_sats: 50,
      token_yes_to_no: "",
      token_no_to_yes: "",
      status: "locked",
    });

    const res = await jsonPost(app, `/markets/${market.id}/resolve`, {
      outcome: "yes",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      settled_pairs: Array<{ winner_pubkey: string; amount_sats: number }>;
    };
    expect(body.settled_pairs).toHaveLength(1);
    expect(body.settled_pairs[0].winner_pubkey).toBe("alice");
    expect(body.settled_pairs[0].amount_sats).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

describe("Redemption", () => {
  test("POST /markets/:id/redeem returns winning pairs", async () => {
    const { app, state } = makeTestApp();
    const market = await createMarket(app);

    // Inject matched pair with distinct pubkeys (demo mode sets both to
    // the triggering bettor, so we test redemption logic directly).
    state.matchedPairs.set("pair_redeem1", {
      pair_id: "pair_redeem1",
      market_id: market.id as string,
      yes_pubkey: "alice",
      no_pubkey: "bob",
      amount_sats: 100,
      token_yes_to_no: "",
      token_no_to_yes: "",
      status: "locked",
    });

    // Resolve YES
    await jsonPost(app, `/markets/${market.id}/resolve`, { outcome: "yes" });

    // Alice (YES winner) redeems
    const res = await jsonPost(app, `/markets/${market.id}/redeem`, {
      pubkey: "alice",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      pairs: Array<{
        pair_id: string;
        amount_sats: number;
        oracle_signature?: string;
      }>;
    };
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0].amount_sats).toBe(100);
    // Should include oracle_signature (FROST P2PK mode)
    expect(body.pairs[0].oracle_signature).toBeTruthy();
  });

  test("POST /markets/:id/redeem for loser returns empty pairs", async () => {
    const { app, state } = makeTestApp();
    const market = await createMarket(app);

    // Inject matched pair with distinct pubkeys
    state.matchedPairs.set("pair_redeem2", {
      pair_id: "pair_redeem2",
      market_id: market.id as string,
      yes_pubkey: "alice",
      no_pubkey: "bob",
      amount_sats: 100,
      token_yes_to_no: "",
      token_no_to_yes: "",
      status: "locked",
    });

    // Resolve YES — bob loses
    await jsonPost(app, `/markets/${market.id}/resolve`, { outcome: "yes" });

    const res = await jsonPost(app, `/markets/${market.id}/redeem`, {
      pubkey: "bob",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { pairs: unknown[] };
    expect(body.pairs).toHaveLength(0);
  });

  test("POST /markets/:id/redeem on unresolved market returns 409", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    const res = await jsonPost(app, `/markets/${market.id}/redeem`, {
      pubkey: "alice",
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("not resolved");
  });

  test("POST /markets/:id/redeem with missing pubkey returns 400", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    // Resolve first
    await jsonPost(app, `/markets/${market.id}/resolve`, { outcome: "yes" });

    const res = await jsonPost(app, `/markets/${market.id}/redeem`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("pubkey");
  });

  test("POST /markets/:id/redeem for NO winner works", async () => {
    const { app, state } = makeTestApp();
    const market = await createMarket(app);

    // Inject matched pair with distinct pubkeys
    state.matchedPairs.set("pair_redeem3", {
      pair_id: "pair_redeem3",
      market_id: market.id as string,
      yes_pubkey: "alice",
      no_pubkey: "bob",
      amount_sats: 75,
      token_yes_to_no: "",
      token_no_to_yes: "",
      status: "locked",
    });

    // Resolve NO — bob wins
    await jsonPost(app, `/markets/${market.id}/resolve`, { outcome: "no" });

    const res = await jsonPost(app, `/markets/${market.id}/redeem`, {
      pubkey: "bob",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { pairs: Array<{ amount_sats: number }> };
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0].amount_sats).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Wallet endpoints
// ---------------------------------------------------------------------------

describe("Wallet", () => {
  test("GET /markets/wallet/balance returns 0 for new user", async () => {
    const { app } = makeTestApp();
    const res = await jsonGet(app, "/markets/wallet/balance?pubkey=new_user");
    expect(res.status).toBe(200);
    const body = await res.json() as { pubkey: string; balance_sats: number };
    expect(body.pubkey).toBe("new_user");
    expect(body.balance_sats).toBe(0);
  });

  test("GET /markets/wallet/balance without pubkey returns 400", async () => {
    const { app } = makeTestApp();
    const res = await jsonGet(app, "/markets/wallet/balance");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("pubkey");
  });

  test("POST /markets/wallet/faucet returns 503 when mint not configured", async () => {
    // Inject a getCashuWallet that returns null (no mint)
    const { app } = makeTestApp({
      getCashuWallet: async () => null,
    });
    const res = await jsonPost(app, "/markets/wallet/faucet", {
      pubkey: "alice",
      amount_sats: 1000,
    });
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Cashu mint not configured");
  });
});

// ---------------------------------------------------------------------------
// Orders endpoint
// ---------------------------------------------------------------------------

describe("Orders", () => {
  test("GET /markets/:id/orders returns open orders", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes", amount_sats: 100, bettor_pubkey: "alice",
    });

    const res = await jsonGet(app, `/markets/${market.id}/orders`);
    expect(res.status).toBe(200);
    const orders = await res.json() as Array<{
      id: string;
      side: string;
      amount_sats: number;
    }>;
    expect(orders).toHaveLength(1);
    expect(orders[0].side).toBe("yes");
    expect(orders[0].amount_sats).toBe(100);
  });

  test("GET /markets/:id/orders?side=yes filters by side", async () => {
    const { app } = makeTestApp();
    const market = await createMarket(app);

    await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "yes", amount_sats: 100, bettor_pubkey: "alice",
    });
    await jsonPost(app, `/markets/${market.id}/bet`, {
      side: "no", amount_sats: 50, bettor_pubkey: "bob",
    });

    // YES had 100, NO had 50 => match 50. YES has 50 remaining. NO has 0 remaining.
    const res = await jsonGet(app, `/markets/${market.id}/orders?side=no`);
    expect(res.status).toBe(200);
    const orders = await res.json() as Array<{ side: string }>;
    expect(orders).toHaveLength(0);
  });

  test("GET /markets/:id/orders on nonexistent market returns 404", async () => {
    const { app } = makeTestApp();
    const res = await jsonGet(app, "/markets/mkt_fake/orders");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe("Test isolation", () => {
  test("separate app instances do not share market state", async () => {
    const { app: app1 } = makeTestApp();
    const { app: app2 } = makeTestApp();

    const market = await createMarket(app1);

    const res1 = await jsonGet(app1, `/markets/${market.id}`);
    expect(res1.status).toBe(200);

    const res2 = await jsonGet(app2, `/markets/${market.id}`);
    expect(res2.status).toBe(404);
  });
});
