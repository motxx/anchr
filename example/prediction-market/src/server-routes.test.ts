/**
 * Unit tests for server-routes.ts (non-custodial matchmaker)
 *
 * Uses injected MarketState for complete isolation -- no module-level
 * singletons, no Docker, no Cashu mint.
 *
 * Key changes from custodial version:
 * - Server no longer creates/holds tokens
 * - Bet endpoint returns match announcements with counterparty info
 * - Users submit P2PK-locked tokens via submit-token endpoint
 * - sign-proofs endpoint lets winners get Oracle signatures
 */

import { describe, test, beforeEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  registerMarketRoutes,
  createMarketState,
  type MarketState,
  type MarketRouteContext,
} from "./server-routes.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** No-op middleware -- tests don't need auth or rate limiting. */
const passthrough: MiddlewareHandler = async (_c, next) => { await next(); };

function makeTestApp(state?: MarketState) {
  const st = state ?? createMarketState();
  // deno-lint-ignore no-explicit-any
  const app = new Hono<any>();
  const ctx: MarketRouteContext = { writeAuth: passthrough, rateLimit: passthrough };
  registerMarketRoutes(app, ctx, st);
  return { app, state: st };
}

const BASE = "http://localhost";

function createMarketBody(overrides?: Record<string, unknown>) {
  return {
    title: "Will BTC hit $200K?",
    description: "By end of 2026",
    category: "crypto",
    resolution_url: "https://api.example.com/price",
    resolution_deadline: Math.floor(Date.now() / 1000) + 86400,
    resolution_condition: {
      type: "price_above",
      target_url: "https://api.example.com/price",
      threshold: 200000,
      description: "BTC > $200K",
    },
    ...overrides,
  };
}

async function createMarket(
  app: Hono,
  overrides?: Record<string, unknown>,
): Promise<{ id: string; [k: string]: unknown }> {
  const res = await app.request(`${BASE}/markets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createMarketBody(overrides)),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string }>;
}

async function placeBet(
  app: Hono,
  marketId: string,
  side: "yes" | "no",
  amount_sats: number,
  bettor_pubkey: string,
): Promise<{
  order_id: string;
  matches: Array<{
    pair_id: string;
    amount_sats: number;
    counterparty_pubkey: string;
    group_pubkey_yes: string;
    group_pubkey_no: string;
    locktime_exchange: number;
    locktime_market: number;
  }>;
  [k: string]: unknown;
}> {
  const res = await app.request(`${BASE}/markets/${marketId}/bet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ side, amount_sats, bettor_pubkey }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ order_id: string; matches: Array<{ pair_id: string; amount_sats: number; counterparty_pubkey: string; group_pubkey_yes: string; group_pubkey_no: string; locktime_exchange: number; locktime_market: number }> }>;
}

// ---------------------------------------------------------------------------
// Test: isolated app instances
// ---------------------------------------------------------------------------

describe("Market API: isolation", () => {
  test("isolated instances do not share state", async () => {
    const { app: app1 } = makeTestApp();
    const { app: app2 } = makeTestApp();

    await createMarket(app1);

    const res1 = await app1.request(`${BASE}/markets`);
    const list1 = await res1.json() as unknown[];
    expect(list1).toHaveLength(1);

    const res2 = await app2.request(`${BASE}/markets`);
    const list2 = await res2.json() as unknown[];
    expect(list2).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test: Market CRUD
// ---------------------------------------------------------------------------

describe("Market API: CRUD", () => {
  let app: Hono;

  beforeEach(() => {
    const t = makeTestApp();
    app = t.app;
  });

  test("POST /markets creates a market", async () => {
    const json = await createMarket(app);
    expect(json.id).toMatch(/^mkt_/);
    expect(json.title).toBe("Will BTC hit $200K?");
    expect(json.status).toBe("open");
    expect(json.yes_pool_sats).toBe(0);
    expect(json.no_pool_sats).toBe(0);
    expect(json.group_pubkey_yes).toBeTruthy();
    expect(json.group_pubkey_no).toBeTruthy();
    expect(json.htlc_hash_yes).toBeTruthy();
    expect(json.htlc_hash_no).toBeTruthy();
  });

  test("GET /markets lists all markets", async () => {
    await createMarket(app, { title: "Market A" });
    await createMarket(app, { title: "Market B" });

    const res = await app.request(`${BASE}/markets`);
    expect(res.status).toBe(200);
    const list = await res.json() as Array<{ title: string }>;
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.title).sort()).toEqual(["Market A", "Market B"]);
  });

  test("GET /markets?category= filters by category", async () => {
    await createMarket(app, { title: "Crypto", category: "crypto" });
    await createMarket(app, { title: "Sports", category: "sports" });

    const res = await app.request(`${BASE}/markets?category=sports`);
    const list = await res.json() as Array<{ title: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("Sports");
  });

  test("GET /markets/:id returns market detail", async () => {
    const created = await createMarket(app);
    const res = await app.request(`${BASE}/markets/${created.id}`);
    expect(res.status).toBe(200);
    const json = await res.json() as { id: string; title: string; open_orders: number; matched_pairs: number };
    expect(json.id).toBe(created.id);
    expect(json.open_orders).toBe(0);
    expect(json.matched_pairs).toBe(0);
  });

  test("GET /markets/:id returns 404 for unknown market", async () => {
    const res = await app.request(`${BASE}/markets/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("POST /markets rejects missing title", async () => {
    const res = await app.request(`${BASE}/markets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createMarketBody({ title: "" })),
    });
    expect(res.status).toBe(400);
  });

  test("POST /markets rejects invalid category", async () => {
    const res = await app.request(`${BASE}/markets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createMarketBody({ category: "invalid" })),
    });
    expect(res.status).toBe(400);
  });

  test("POST /markets rejects missing resolution_url", async () => {
    const res = await app.request(`${BASE}/markets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createMarketBody({ resolution_url: "" })),
    });
    expect(res.status).toBe(400);
  });

  test("POST /markets rejects missing resolution_deadline", async () => {
    const res = await app.request(`${BASE}/markets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createMarketBody({ resolution_deadline: 0 })),
    });
    expect(res.status).toBe(400);
  });

  test("POST /markets rejects jsonpath_gt without threshold", async () => {
    const res = await app.request(`${BASE}/markets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createMarketBody({
        resolution_condition: {
          type: "jsonpath_gt",
          target_url: "https://example.com",
          jsonpath: "data.price",
          description: "test",
        },
      })),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("threshold");
  });
});

// ---------------------------------------------------------------------------
// Test: Betting (pure matchmaker)
// ---------------------------------------------------------------------------

describe("Market API: betting", () => {
  let app: Hono;
  let marketId: string;

  beforeEach(async () => {
    const t = makeTestApp();
    app = t.app;
    const created = await createMarket(app);
    marketId = created.id as string;
  });

  test("POST /markets/:id/bet places a YES bet", async () => {
    const json = await placeBet(app, marketId, "yes", 100, "alice");
    expect(json.order_id).toMatch(/^ord_/);
    expect(json.matches).toHaveLength(0);
  });

  test("POST /markets/:id/bet updates pool totals", async () => {
    await placeBet(app, marketId, "yes", 100, "alice");
    await placeBet(app, marketId, "no", 50, "bob");

    const res = await app.request(`${BASE}/markets/${marketId}`);
    const json = await res.json() as { yes_pool_sats: number; no_pool_sats: number };
    expect(json.yes_pool_sats).toBe(100);
    expect(json.no_pool_sats).toBe(50);
  });

  test("POST /markets/:id/bet rejects invalid side", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/bet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "maybe", amount_sats: 100, bettor_pubkey: "alice" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /markets/:id/bet rejects zero amount", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/bet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "yes", amount_sats: 0, bettor_pubkey: "alice" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /markets/:id/bet enforces min_bet_sats", async () => {
    const created = await createMarket(app, { min_bet_sats: 50 });
    const res = await app.request(`${BASE}/markets/${created.id}/bet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "yes", amount_sats: 10, bettor_pubkey: "alice" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /markets/:id/bet enforces max_bet_sats", async () => {
    const created = await createMarket(app, { max_bet_sats: 500 });
    const res = await app.request(`${BASE}/markets/${created.id}/bet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "yes", amount_sats: 1000, bettor_pubkey: "alice" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /markets/:id/bet rejects bet on non-open market", async () => {
    await placeBet(app, marketId, "yes", 100, "alice");
    await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
    const res = await app.request(`${BASE}/markets/${marketId}/bet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "yes", amount_sats: 100, bettor_pubkey: "charlie" }),
    });
    expect(res.status).toBe(409);
  });

  test("POST /markets/:id/bet returns 404 for unknown market", async () => {
    const res = await app.request(`${BASE}/markets/nonexistent/bet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "yes", amount_sats: 100, bettor_pubkey: "alice" }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Test: Matching (pure matchmaker)
// ---------------------------------------------------------------------------

describe("Market API: matching", () => {
  let app: Hono;
  let state: MarketState;
  let marketId: string;

  beforeEach(async () => {
    const t = makeTestApp();
    app = t.app;
    state = t.state;
    const created = await createMarket(app);
    marketId = created.id as string;
  });

  test("YES + NO orders produce a match with counterparty info", async () => {
    await placeBet(app, marketId, "yes", 100, "alice");
    const json = await placeBet(app, marketId, "no", 100, "bob");
    expect(json.matches).toHaveLength(1);
    expect(json.matches[0]!.amount_sats).toBe(100);
    expect(json.matches[0]!.pair_id).toMatch(/^pair_/);
    // Bob placed the NO bet, so counterparty should be alice (the YES bettor)
    expect(json.matches[0]!.counterparty_pubkey).toBe("alice");
    // Group pubkeys should be present
    expect(json.matches[0]!.group_pubkey_yes).toBeTruthy();
    expect(json.matches[0]!.group_pubkey_no).toBeTruthy();
    // Locktimes should be present
    expect(json.matches[0]!.locktime_exchange).toBeGreaterThan(0);
    expect(json.matches[0]!.locktime_market).toBeGreaterThan(0);
  });

  test("partial match when amounts differ", async () => {
    await placeBet(app, marketId, "yes", 200, "alice");
    const json = await placeBet(app, marketId, "no", 100, "bob");
    expect(json.matches).toHaveLength(1);
    expect(json.matches[0]!.amount_sats).toBe(100);
  });

  test("order book FIFO: earlier orders matched first", async () => {
    await placeBet(app, marketId, "yes", 50, "alice");
    await placeBet(app, marketId, "yes", 50, "charlie");
    await placeBet(app, marketId, "no", 50, "bob");

    // alice's order fully matched, charlie's still open
    const openOrders = state.orderBook.getOpenOrders(marketId, "yes");
    expect(openOrders).toHaveLength(1);
    expect(openOrders[0]!.remaining_sats).toBe(50);
  });

  test("multiple matches from one large order", async () => {
    await placeBet(app, marketId, "yes", 50, "alice");
    await placeBet(app, marketId, "yes", 50, "charlie");
    const json = await placeBet(app, marketId, "no", 100, "bob");
    expect(json.matches).toHaveLength(2);
    expect(json.matches[0]!.amount_sats).toBe(50);
    expect(json.matches[1]!.amount_sats).toBe(50);
  });

  test("matched pairs start with pending status", async () => {
    await placeBet(app, marketId, "yes", 100, "alice");
    await placeBet(app, marketId, "no", 100, "bob");

    const pairs = Array.from(state.matchedPairs.values());
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.status).toBe("pending");
    // Tokens are empty until users submit them
    expect(pairs[0]!.token_yes_to_no).toBe("");
    expect(pairs[0]!.token_no_to_yes).toBe("");
  });

  test("GET /markets/:id/orders returns open orders", async () => {
    await placeBet(app, marketId, "yes", 100, "alice");
    const res = await app.request(`${BASE}/markets/${marketId}/orders`);
    expect(res.status).toBe(200);
    const orders = await res.json() as Array<{ side: string; amount_sats: number }>;
    expect(orders).toHaveLength(1);
    expect(orders[0]!.side).toBe("yes");
  });

  test("GET /markets/:id/orders returns 404 for unknown market", async () => {
    const res = await app.request(`${BASE}/markets/nonexistent/orders`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Test: Resolution (single-key mode)
// ---------------------------------------------------------------------------

describe("Market API: resolution (single-key)", () => {
  let app: Hono;
  let state: MarketState;
  let marketId: string;

  beforeEach(async () => {
    const t = makeTestApp();
    app = t.app;
    state = t.state;
    const created = await createMarket(app);
    marketId = created.id as string;
    await placeBet(app, marketId, "yes", 100, "alice");
    await placeBet(app, marketId, "no", 100, "bob");

    // Fix pubkeys in matched pairs for resolution testing
    for (const pair of state.matchedPairs.values()) {
      if (pair.market_id === marketId) {
        pair.yes_pubkey = "alice";
        pair.no_pubkey = "bob";
      }
    }
  });

  test("resolve YES -- signs and returns oracle_signature", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      market_id: string; outcome: string; oracle_signature?: string;
      mode: string; status: string; settled_pairs: Array<{ amount_sats: number }>;
    };
    expect(json.market_id).toBe(marketId);
    expect(json.outcome).toBe("yes");
    expect(json.mode).toBe("frost_p2pk");
    expect(json.oracle_signature).toBeTruthy();
    expect(json.status).toBe("resolved_yes");
    expect(json.settled_pairs).toHaveLength(1);
  });

  test("resolve NO -- produces resolved_no status", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "no" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { outcome: string; status: string; settled_pairs: unknown[] };
    expect(json.outcome).toBe("no");
    expect(json.status).toBe("resolved_no");
    expect(json.settled_pairs).toHaveLength(1);
  });

  test("double resolve is rejected", async () => {
    const res1 = await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "no" }),
    });
    expect(res2.status).toBe(409);
  });

  test("invalid outcome returns 400", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "maybe" }),
    });
    expect(res.status).toBe(400);
  });

  test("unknown market returns 404", async () => {
    const res = await app.request(`${BASE}/markets/nonexistent/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Test: Resolution (FROST mode with mock)
// ---------------------------------------------------------------------------

describe("Market API: resolution (FROST mode mock)", () => {
  test("dualKeyStore.sign is called with correct outcome", async () => {
    const state = createMarketState();
    const signCalls: Array<{ swapId: string; outcome: string }> = [];
    const origSign = state.dualKeyStore.sign.bind(state.dualKeyStore);
    state.dualKeyStore.sign = (swapId: string, outcome: "a" | "b", message: Uint8Array): string | null => {
      signCalls.push({ swapId, outcome });
      return origSign(swapId, outcome, message);
    };

    const { app } = makeTestApp(state);
    const created = await createMarket(app);
    const marketId = created.id as string;

    await placeBet(app, marketId, "yes", 100, "alice");
    await placeBet(app, marketId, "no", 100, "bob");

    const res = await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
    expect(res.status).toBe(200);
    expect(signCalls).toHaveLength(1);
    expect(signCalls[0]!.outcome).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Test: Redemption (non-custodial)
// ---------------------------------------------------------------------------

describe("Market API: redemption", () => {
  let app: Hono;
  let state: MarketState;
  let marketId: string;

  beforeEach(async () => {
    const t = makeTestApp();
    app = t.app;
    state = t.state;
    const created = await createMarket(app);
    marketId = created.id as string;
    await placeBet(app, marketId, "yes", 100, "alice");
    await placeBet(app, marketId, "no", 100, "bob");

    // Fix pubkeys in matched pairs for redemption testing
    for (const pair of state.matchedPairs.values()) {
      if (pair.market_id === marketId) {
        pair.yes_pubkey = "alice";
        pair.no_pubkey = "bob";
      }
    }

    await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
  });

  test("winner gets oracle_signature (non-custodial)", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "alice" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { winning_pairs: number; total_winning_sats: number; oracle_signature?: string };
    expect(json.winning_pairs).toBe(1);
    expect(json.total_winning_sats).toBe(100);
    expect(json.oracle_signature).toBeTruthy();
  });

  test("loser gets zero winning pairs", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "bob" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { winning_pairs: number };
    expect(json.winning_pairs).toBe(0);
  });

  test("non-participant gets zero winning pairs", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "charlie" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { winning_pairs: number };
    expect(json.winning_pairs).toBe(0);
  });

  test("redeem on unresolved market returns 409", async () => {
    const created2 = await createMarket(app);
    const res = await app.request(`${BASE}/markets/${created2.id}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "alice" }),
    });
    expect(res.status).toBe(409);
  });

  test("redeem requires pubkey", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Test: Submit token (non-custodial exchange)
// ---------------------------------------------------------------------------

describe("Market API: submit-token", () => {
  let app: Hono;
  let state: MarketState;
  let marketId: string;
  let pairId: string;

  beforeEach(async () => {
    const t = makeTestApp();
    app = t.app;
    state = t.state;
    const created = await createMarket(app);
    marketId = created.id as string;

    await placeBet(app, marketId, "yes", 100, "alice");
    const betJson = await placeBet(app, marketId, "no", 100, "bob");
    pairId = betJson.matches[0]!.pair_id;
  });

  test("submit-token rejects unknown pair", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/submit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair_id: "unknown", cashu_token: "cashuBtest", bettor_pubkey: "alice" }),
    });
    expect(res.status).toBe(404);
  });

  test("submit-token rejects non-participant", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/submit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair_id: pairId, cashu_token: "cashuBtest", bettor_pubkey: "charlie" }),
    });
    expect(res.status).toBe(403);
  });

  test("submit-token accepts first token and returns pending", async () => {
    // Without real Cashu tokens, group pubkeys won't trigger verification
    // In demo mode (no group pubkeys set with real P2PK secrets),
    // the token is accepted without deep P2PK verification
    const res = await app.request(`${BASE}/markets/${marketId}/submit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair_id: pairId, cashu_token: "cashuBfake_yes_token", bettor_pubkey: "alice" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { pair_id: string; status: string };
    expect(json.status).toBe("pending");
  });

  test("submit-token distributes when both sides submit", async () => {
    // Submit YES side
    await app.request(`${BASE}/markets/${marketId}/submit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair_id: pairId, cashu_token: "cashuBfake_yes_token", bettor_pubkey: "alice" }),
    });

    // Submit NO side — should complete the exchange
    const res = await app.request(`${BASE}/markets/${marketId}/submit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair_id: pairId, cashu_token: "cashuBfake_no_token", bettor_pubkey: "bob" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { pair_id: string; status: string; redeemable_token?: string };
    expect(json.status).toBe("locked");
    // Bob (NO side) should receive the YES side's token
    expect(json.redeemable_token).toBe("cashuBfake_yes_token");

    // Verify pair is now locked
    const pair = state.matchedPairs.get(pairId);
    expect(pair!.status).toBe("locked");
    expect(pair!.token_yes_to_no).toBe("cashuBfake_yes_token");
    expect(pair!.token_no_to_yes).toBe("cashuBfake_no_token");
  });
});

// ---------------------------------------------------------------------------
// Test: Sign proofs endpoint
// ---------------------------------------------------------------------------

describe("Market API: sign-proofs", () => {
  let app: Hono;
  let state: MarketState;
  let marketId: string;

  beforeEach(async () => {
    const t = makeTestApp();
    app = t.app;
    state = t.state;
    const created = await createMarket(app);
    marketId = created.id as string;
    await placeBet(app, marketId, "yes", 100, "alice");
    await placeBet(app, marketId, "no", 100, "bob");

    for (const pair of state.matchedPairs.values()) {
      if (pair.market_id === marketId) {
        pair.yes_pubkey = "alice";
        pair.no_pubkey = "bob";
      }
    }

    await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
  });

  test("sign-proofs returns signatures for winner", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/sign-proofs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: "alice",
        proof_secrets: ["secret1", "secret2"],
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      outcome: string;
      oracle_signatures: Record<string, string>;
      signed_count: number;
      total_requested: number;
    };
    expect(json.outcome).toBe("yes");
    expect(json.signed_count).toBe(2);
    expect(json.total_requested).toBe(2);
    expect(json.oracle_signatures["secret1"]).toBeTruthy();
    expect(json.oracle_signatures["secret2"]).toBeTruthy();
  });

  test("sign-proofs rejects non-winner", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/sign-proofs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: "bob",
        proof_secrets: ["secret1"],
      }),
    });
    expect(res.status).toBe(403);
  });

  test("sign-proofs rejects unresolved market", async () => {
    const created2 = await createMarket(app);
    const res = await app.request(`${BASE}/markets/${created2.id}/sign-proofs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: "alice",
        proof_secrets: ["secret1"],
      }),
    });
    expect(res.status).toBe(409);
  });

  test("sign-proofs rejects empty proof_secrets", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/sign-proofs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: "alice",
        proof_secrets: [],
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Test: Market detail with user pairs
// ---------------------------------------------------------------------------

describe("Market API: user pairs in detail", () => {
  test("GET /markets/:id?pubkey= includes user_pairs with win status", async () => {
    const { app, state } = makeTestApp();
    const created = await createMarket(app);
    const marketId = created.id as string;

    await placeBet(app, marketId, "yes", 100, "alice");
    await placeBet(app, marketId, "no", 100, "bob");

    for (const pair of state.matchedPairs.values()) {
      if (pair.market_id === marketId) {
        pair.yes_pubkey = "alice";
        pair.no_pubkey = "bob";
      }
    }

    await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });

    const resAlice = await app.request(`${BASE}/markets/${marketId}?pubkey=alice`);
    const jsonAlice = await resAlice.json() as { user_pairs: Array<{ side: string; won: boolean }> };
    expect(jsonAlice.user_pairs).toHaveLength(1);
    expect(jsonAlice.user_pairs[0]!.side).toBe("yes");
    expect(jsonAlice.user_pairs[0]!.won).toBe(true);

    const resBob = await app.request(`${BASE}/markets/${marketId}?pubkey=bob`);
    const jsonBob = await resBob.json() as { user_pairs: Array<{ side: string; won: boolean }> };
    expect(jsonBob.user_pairs).toHaveLength(1);
    expect(jsonBob.user_pairs[0]!.side).toBe("no");
    expect(jsonBob.user_pairs[0]!.won).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: Faucet (non-custodial — returns cashuB token)
// ---------------------------------------------------------------------------

describe("Market API: faucet (non-custodial)", () => {
  test("faucet returns 503 when no wallet configured", async () => {
    const state = createMarketState();
    state.getCashuWallet = async () => null;
    const { app } = makeTestApp(state);
    const res = await app.request(`${BASE}/markets/wallet/faucet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount_sats: 1000 }),
    });
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Test: Full lifecycle (non-custodial)
// ---------------------------------------------------------------------------

describe("Market API: full lifecycle", () => {
  test("YES resolution lifecycle", async () => {
    const { app, state } = makeTestApp();
    const created = await createMarket(app);
    const marketId = created.id as string;

    await placeBet(app, marketId, "yes", 200, "alice");
    const betJson = await placeBet(app, marketId, "no", 200, "bob");
    expect(betJson.matches).toHaveLength(1);
    // Match response has counterparty info
    expect(betJson.matches[0]!.counterparty_pubkey).toBe("alice");
    expect(betJson.matches[0]!.group_pubkey_yes).toBeTruthy();

    for (const pair of state.matchedPairs.values()) {
      if (pair.market_id === marketId) {
        pair.yes_pubkey = "alice";
        pair.no_pubkey = "bob";
      }
    }

    const resolveRes = await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
    expect(resolveRes.status).toBe(200);
    const resolveJson = await resolveRes.json() as { oracle_signature?: string; settled_pairs: unknown[] };
    expect(resolveJson.oracle_signature).toBeTruthy();
    expect(resolveJson.settled_pairs).toHaveLength(1);

    // Winner (alice) can redeem
    const redeemRes = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "alice" }),
    });
    const redeemJson = await redeemRes.json() as { winning_pairs: number; oracle_signature?: string };
    expect(redeemJson.winning_pairs).toBe(1);
    expect(redeemJson.oracle_signature).toBeTruthy();

    // Loser (bob) gets nothing
    const bobRedeem = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "bob" }),
    });
    const bobJson = await bobRedeem.json() as { winning_pairs: number };
    expect(bobJson.winning_pairs).toBe(0);
  });

  test("NO resolution lifecycle", async () => {
    const { app, state } = makeTestApp();
    const created = await createMarket(app);
    const marketId = created.id as string;

    await placeBet(app, marketId, "yes", 100, "alice");
    await placeBet(app, marketId, "no", 100, "bob");

    for (const pair of state.matchedPairs.values()) {
      if (pair.market_id === marketId) {
        pair.yes_pubkey = "alice";
        pair.no_pubkey = "bob";
      }
    }

    const resolveRes = await app.request(`${BASE}/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "no" }),
    });
    expect(resolveRes.status).toBe(200);
    const resolveJson = await resolveRes.json() as { status: string };
    expect(resolveJson.status).toBe("resolved_no");

    const bobRedeem = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "bob" }),
    });
    const bobJson = await bobRedeem.json() as { winning_pairs: number; oracle_signature?: string };
    expect(bobJson.winning_pairs).toBe(1);
    expect(bobJson.oracle_signature).toBeTruthy();

    const aliceRedeem = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "alice" }),
    });
    const aliceJson = await aliceRedeem.json() as { winning_pairs: number };
    expect(aliceJson.winning_pairs).toBe(0);
  });
});
