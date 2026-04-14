/**
 * Unit tests for market-api-routes.ts
 *
 * Uses injected MarketState for complete isolation -- no module-level
 * singletons, no Docker, no Cashu mint.
 */

import { describe, test, beforeEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Proof } from "@cashu/cashu-ts";
import {
  registerMarketRoutes,
  createMarketState,
  type MarketState,
  type MarketRouteContext,
} from "./server-routes.ts";
import {
  getUserBalance,
  creditUser,
  debitUser,
} from "./market-wallet.ts";

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
): Promise<{ order_id: string; matches: Array<{ pair_id: string; amount_sats: number }>; [k: string]: unknown }> {
  const res = await app.request(`${BASE}/markets/${marketId}/bet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ side, amount_sats, bettor_pubkey }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ order_id: string; matches: Array<{ pair_id: string; amount_sats: number }> }>;
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
// Test: Betting
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
// Test: Matching
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

  test("YES + NO orders produce a match", async () => {
    await placeBet(app, marketId, "yes", 100, "alice");
    const json = await placeBet(app, marketId, "no", 100, "bob");
    expect(json.matches).toHaveLength(1);
    expect(json.matches[0]!.amount_sats).toBe(100);
    expect(json.matches[0]!.pair_id).toMatch(/^pair_/);
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
  let marketId: string;

  beforeEach(async () => {
    const t = makeTestApp();
    app = t.app;
    const created = await createMarket(app);
    marketId = created.id as string;
    await placeBet(app, marketId, "yes", 100, "alice");
    await placeBet(app, marketId, "no", 100, "bob");
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
// Test: Redemption
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

    // In demo mode (no Cashu), matched pairs get both pubkeys set to
    // the latest bettor. Manually fix to test redemption logic properly.
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

  test("winner gets oracle_signature", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "alice" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { pairs: Array<{ oracle_signature?: string; amount_sats: number }> };
    expect(json.pairs).toHaveLength(1);
    expect(json.pairs[0]!.amount_sats).toBe(100);
    expect(json.pairs[0]!.oracle_signature).toBeTruthy();
  });

  test("loser gets nothing", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "bob" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { pairs: unknown[] };
    expect(json.pairs).toHaveLength(0);
  });

  test("non-participant gets nothing", async () => {
    const res = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "charlie" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { pairs: unknown[] };
    expect(json.pairs).toHaveLength(0);
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
// Test: Wallet operations (unit, no Docker/Cashu)
// ---------------------------------------------------------------------------

function mockProof(amount: number, id?: string): Proof {
  return {
    amount,
    id: id ?? "mock-keyset",
    secret: `secret-${Math.random().toString(36).slice(2)}`,
    C: `C-${Math.random().toString(36).slice(2)}`,
  } as Proof;
}

describe("Market wallet: getUserBalance", () => {
  test("returns 0 for unknown user", () => {
    const map = new Map<string, Proof[]>();
    expect(getUserBalance(map, "unknown")).toBe(0);
  });

  test("sums proof amounts", () => {
    const map = new Map<string, Proof[]>();
    map.set("alice", [mockProof(10), mockProof(20), mockProof(5)]);
    expect(getUserBalance(map, "alice")).toBe(35);
  });
});

describe("Market wallet: creditUser", () => {
  test("adds proofs to empty user", () => {
    const map = new Map<string, Proof[]>();
    creditUser(map, "alice", [mockProof(100)]);
    expect(getUserBalance(map, "alice")).toBe(100);
  });

  test("appends proofs to existing user", () => {
    const map = new Map<string, Proof[]>();
    creditUser(map, "alice", [mockProof(50)]);
    creditUser(map, "alice", [mockProof(30)]);
    expect(getUserBalance(map, "alice")).toBe(80);
  });
});

describe("Market wallet: debitUser", () => {
  test("returns null when balance insufficient", async () => {
    const map = new Map<string, Proof[]>();
    map.set("alice", [mockProof(5)]);
    const mockWallet = {} as unknown as import("@cashu/cashu-ts").Wallet;
    const result = await debitUser(map, "alice", 100, mockWallet);
    expect(result).toBeNull();
  });

  test("exact match deducts and returns proofs", async () => {
    const map = new Map<string, Proof[]>();
    map.set("alice", [mockProof(50), mockProof(30), mockProof(20)]);
    const mockWallet = {} as unknown as import("@cashu/cashu-ts").Wallet;
    const result = await debitUser(map, "alice", 80, mockWallet);
    expect(result).not.toBeNull();
    expect(result!.reduce((a, p) => a + p.amount, 0)).toBe(80);
    expect(getUserBalance(map, "alice")).toBe(20);
  });

  test("single proof exact match", async () => {
    const map = new Map<string, Proof[]>();
    map.set("alice", [mockProof(100)]);
    const mockWallet = {} as unknown as import("@cashu/cashu-ts").Wallet;
    const result = await debitUser(map, "alice", 100, mockWallet);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(getUserBalance(map, "alice")).toBe(0);
  });

  test("greedy largest-first selection", async () => {
    const map = new Map<string, Proof[]>();
    map.set("alice", [mockProof(10), mockProof(50), mockProof(20)]);
    const mockWallet = {} as unknown as import("@cashu/cashu-ts").Wallet;
    // sorted: [50, 20, 10], greedy takes 50+20=70
    const result = await debitUser(map, "alice", 70, mockWallet);
    expect(result).not.toBeNull();
    expect(result!.reduce((a, p) => a + p.amount, 0)).toBe(70);
    expect(getUserBalance(map, "alice")).toBe(10);
  });

  test("returns null for empty user", async () => {
    const map = new Map<string, Proof[]>();
    const mockWallet = {} as unknown as import("@cashu/cashu-ts").Wallet;
    expect(await debitUser(map, "alice", 10, mockWallet)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test: Wallet endpoints
// ---------------------------------------------------------------------------

describe("Market API: wallet endpoints", () => {
  test("GET /markets/wallet/balance returns 0 for new user", async () => {
    const { app } = makeTestApp();
    const res = await app.request(`${BASE}/markets/wallet/balance?pubkey=alice`);
    expect(res.status).toBe(200);
    const json = await res.json() as { balance_sats: number };
    expect(json.balance_sats).toBe(0);
  });

  test("GET /markets/wallet/balance returns 400 without pubkey", async () => {
    const { app } = makeTestApp();
    const res = await app.request(`${BASE}/markets/wallet/balance`);
    expect(res.status).toBe(400);
  });

  test("balance reflects credited proofs", async () => {
    const state = createMarketState();
    creditUser(state.userProofs, "alice", [mockProof(50), mockProof(30)]);
    const { app } = makeTestApp(state);
    const res = await app.request(`${BASE}/markets/wallet/balance?pubkey=alice`);
    const json = await res.json() as { balance_sats: number };
    expect(json.balance_sats).toBe(80);
  });

  test("faucet returns 503 when no wallet configured", async () => {
    const state = createMarketState();
    state.getCashuWallet = async () => null;
    const { app } = makeTestApp(state);
    const res = await app.request(`${BASE}/markets/wallet/faucet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "alice", amount_sats: 1000 }),
    });
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Test: Full lifecycle
// ---------------------------------------------------------------------------

describe("Market API: full lifecycle", () => {
  test("YES resolution lifecycle", async () => {
    const { app, state } = makeTestApp();
    const created = await createMarket(app);
    const marketId = created.id as string;

    await placeBet(app, marketId, "yes", 200, "alice");
    const betJson = await placeBet(app, marketId, "no", 200, "bob");
    expect(betJson.matches).toHaveLength(1);

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

    const redeemRes = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "alice" }),
    });
    const redeemJson = await redeemRes.json() as { pairs: Array<{ oracle_signature?: string }> };
    expect(redeemJson.pairs).toHaveLength(1);
    expect(redeemJson.pairs[0]!.oracle_signature).toBeTruthy();

    const bobRedeem = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "bob" }),
    });
    const bobJson = await bobRedeem.json() as { pairs: unknown[] };
    expect(bobJson.pairs).toHaveLength(0);
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
    const bobJson = await bobRedeem.json() as { pairs: Array<{ oracle_signature?: string }> };
    expect(bobJson.pairs).toHaveLength(1);
    expect(bobJson.pairs[0]!.oracle_signature).toBeTruthy();

    const aliceRedeem = await app.request(`${BASE}/markets/${marketId}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: "alice" }),
    });
    const aliceJson = await aliceRedeem.json() as { pairs: unknown[] };
    expect(aliceJson.pairs).toHaveLength(0);
  });
});
