/**
 * Prediction Market HTTP route registration.
 *
 * All routes are under /markets/* and follow the registerXxxRoutes(app, ctx)
 * pattern from worker-api-routes.ts. In-memory market store + order book +
 * dual preimage store, wired into Hono.
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { Wallet, type Proof, getEncodedToken } from "@cashu/cashu-ts";
import type {
  PredictionMarket,
  OpenOrder,
  MatchedBetPair,
  MatchProposal,
  MarketStatus,
} from "../../example/prediction-market/src/market-types.ts";
import { createOrderBook, type OrderBook } from "../../example/prediction-market/src/order-book.ts";
import { createSwapPairTokens } from "./conditional-swap/cross-htlc.ts";
import { resolveMarket } from "../../example/prediction-market/src/resolution.ts";
import {
  createDualPreimageStore,
  type DualPreimageStore,
} from "./conditional-swap/dual-preimage-store.ts";
import type { ConditionalSwapDef } from "../domain/conditional-swap-types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketRouteContext {
  writeAuth: MiddlewareHandler;
  rateLimit: MiddlewareHandler;
}

// ---------------------------------------------------------------------------
// In-memory stores (created once, shared across requests)
// ---------------------------------------------------------------------------

const markets = new Map<string, PredictionMarket>();
const matchedPairsStore = new Map<string, MatchedBetPair>();
const dualPreimageStore: DualPreimageStore = createDualPreimageStore();
const orderBook: OrderBook = createOrderBook();
/** Map orderId → { pubkey, proofs } for cross-HTLC execution */
const orderProofs = new Map<string, { pubkey: string; proofs: Proof[] }>();

// Cashu wallet — initialized lazily when CASHU_MINT_URL is set
let cashuWallet: Wallet | null = null;
async function getCashuWallet(): Promise<Wallet | null> {
  const mintUrl = Deno.env.get("CASHU_MINT_URL");
  if (!mintUrl) return null;
  if (cashuWallet) return cashuWallet;
  try {
    cashuWallet = new Wallet(mintUrl, { unit: "sat" });
    await cashuWallet.loadMint();
    return cashuWallet;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function marketSummary(m: PredictionMarket) {
  const orders = Array.from(matchedPairsStore.values()).filter((p) => p.market_id === m.id);
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    category: m.category,
    status: m.status,
    yes_pool_sats: m.yes_pool_sats,
    no_pool_sats: m.no_pool_sats,
    resolution_url: m.resolution_url,
    resolution_deadline: m.resolution_deadline,
    min_bet_sats: m.min_bet_sats,
    max_bet_sats: m.max_bet_sats,
    fee_ppm: m.fee_ppm,
    oracle_pubkey: m.oracle_pubkey,
    creator_pubkey: m.creator_pubkey,
    htlc_hash: m.htlc_hash_yes,
    htlc_hash_yes: m.htlc_hash_yes,
    htlc_hash_no: m.htlc_hash_no,
    volume_sats: m.yes_pool_sats + m.no_pool_sats,
    num_bettors: orders.length * 2,
    created_at: Math.floor(Date.now() / 1000),
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export function registerMarketRoutes(app: Hono<any>, ctx: MarketRouteContext): void {
  const { writeAuth, rateLimit } = ctx;
  const mkt = new Hono();

  // -----------------------------------------------------------------------
  // GET /markets — list all markets (optional ?category= filter)
  // -----------------------------------------------------------------------

  mkt.get("/", (c) => {
    const category = c.req.query("category");
    let list = Array.from(markets.values());
    if (category) {
      list = list.filter((m) => m.category === category);
    }
    return c.json(list.map(marketSummary));
  });

  // -----------------------------------------------------------------------
  // GET /markets/:id — market detail
  // -----------------------------------------------------------------------

  mkt.get("/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);
    const market = markets.get(id);
    if (!market) return c.json({ error: "Market not found" }, 404);

    const openOrders = orderBook.getOpenOrders(id);
    const matchedPairs = Array.from(matchedPairsStore.values()).filter((b) => b.market_id === id);

    return c.json({
      ...marketSummary(market),
      resolution_url: market.resolution_url,
      resolution_condition: market.resolution_condition,
      oracle_pubkey: market.oracle_pubkey,
      creator_pubkey: market.creator_pubkey,
      open_orders: openOrders.length,
      matched_pairs: matchedPairs.length,
    });
  });

  // -----------------------------------------------------------------------
  // POST /markets — create a new market
  // -----------------------------------------------------------------------

  mkt.post("/", rateLimit, writeAuth, async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    // Required fields
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const category = typeof body.category === "string" ? body.category : "custom";
    const resolution_url = typeof body.resolution_url === "string" ? body.resolution_url : "";
    const resolution_deadline = typeof body.resolution_deadline === "number" ? body.resolution_deadline : 0;

    if (!title) return c.json({ error: "title is required" }, 400);
    if (!resolution_url) return c.json({ error: "resolution_url is required" }, 400);
    if (!resolution_deadline) return c.json({ error: "resolution_deadline is required" }, 400);

    // Validate category
    const validCategories = ["crypto", "sports", "politics", "economics", "custom"];
    if (!validCategories.includes(category)) {
      return c.json({ error: `category must be one of: ${validCategories.join(", ")}` }, 400);
    }

    // Optional fields with defaults
    const min_bet_sats = typeof body.min_bet_sats === "number" ? body.min_bet_sats : 1;
    const max_bet_sats = typeof body.max_bet_sats === "number" ? body.max_bet_sats : 0;
    const fee_ppm = typeof body.fee_ppm === "number" ? body.fee_ppm : 10000; // 1% default
    const creator_pubkey = typeof body.creator_pubkey === "string" ? body.creator_pubkey : "server";
    const oracle_pubkey = typeof body.oracle_pubkey === "string" ? body.oracle_pubkey : "server";

    // Resolution condition
    const rawCondition = body.resolution_condition as Record<string, unknown> | undefined;
    const resolution_condition = rawCondition
      ? {
          type: (typeof rawCondition.type === "string" ? rawCondition.type : "contains_text") as
            "price_above" | "price_below" | "contains_text" | "jsonpath_equals" | "jsonpath_gt" | "jsonpath_lt",
          target_url: typeof rawCondition.target_url === "string" ? rawCondition.target_url : resolution_url,
          jsonpath: typeof rawCondition.jsonpath === "string" ? rawCondition.jsonpath : undefined,
          threshold: typeof rawCondition.threshold === "number" ? rawCondition.threshold : undefined,
          expected_text: typeof rawCondition.expected_text === "string" ? rawCondition.expected_text : undefined,
          description: typeof rawCondition.description === "string" ? rawCondition.description : title,
        }
      : {
          type: "contains_text" as const,
          target_url: resolution_url,
          description: title,
        };

    // Generate market ID and dual preimage pair
    const id = generateId("mkt");
    const hashes = dualPreimageStore.create(id);

    const market: PredictionMarket = {
      id,
      title,
      description,
      category: category as PredictionMarket["category"],
      creator_pubkey,
      resolution_url,
      resolution_condition,
      resolution_deadline,
      yes_pool_sats: 0,
      no_pool_sats: 0,
      min_bet_sats,
      max_bet_sats,
      fee_ppm,
      oracle_pubkey,
      htlc_hash_yes: hashes.hash_a, // outcome A = YES
      htlc_hash_no: hashes.hash_b,  // outcome B = NO
      nostr_event_id: "", // not published to Nostr in API mode
      status: "open",
    };

    markets.set(id, market);

    return c.json(marketSummary(market), 201);
  });

  // -----------------------------------------------------------------------
  // POST /markets/:id/bet — place a bet (YES or NO)
  // -----------------------------------------------------------------------

  mkt.post("/:id/bet", rateLimit, writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    const market = markets.get(id);
    if (!market) return c.json({ error: "Market not found" }, 404);
    if (market.status !== "open") {
      return c.json({ error: `Market is not open (status: ${market.status})` }, 409);
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const side = typeof body.side === "string" ? body.side : "";
    const amount_sats = typeof body.amount_sats === "number" ? body.amount_sats : 0;
    const bettor_pubkey = typeof body.bettor_pubkey === "string" ? body.bettor_pubkey : "";
    const cashu_token = typeof body.cashu_token === "string" ? body.cashu_token : undefined;

    if (side !== "yes" && side !== "no") {
      return c.json({ error: 'side must be "yes" or "no"' }, 400);
    }
    if (amount_sats <= 0) return c.json({ error: "amount_sats must be positive" }, 400);
    if (!bettor_pubkey) return c.json({ error: "bettor_pubkey is required" }, 400);

    // Enforce bet limits
    if (amount_sats < market.min_bet_sats) {
      return c.json({ error: `Minimum bet is ${market.min_bet_sats} sats` }, 400);
    }
    if (market.max_bet_sats > 0 && amount_sats > market.max_bet_sats) {
      return c.json({ error: `Maximum bet is ${market.max_bet_sats} sats` }, 400);
    }

    // Parse Cashu proofs from token (if provided)
    let proofs: Proof[] = [];
    if (cashu_token) {
      try {
        const { getDecodedToken } = await import("@cashu/cashu-ts");
        const decoded = getDecodedToken(cashu_token);
        proofs = decoded.proofs;
        const total = proofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);
        if (total < amount_sats) {
          return c.json({ error: `Cashu token has ${total} sats, need ${amount_sats}` }, 400);
        }
      } catch {
        return c.json({ error: "Invalid cashu_token" }, 400);
      }
    }

    // Add order to the book
    const orderId = generateId("ord");
    const order: OpenOrder = {
      id: orderId,
      market_id: id,
      bettor_pubkey,
      side,
      amount_sats,
      remaining_sats: amount_sats,
      timestamp: Math.floor(Date.now() / 1000),
    };
    orderBook.addOrder(order);
    if (proofs.length > 0) {
      orderProofs.set(orderId, { pubkey: bettor_pubkey, proofs });
    }

    // Update market pool totals
    if (side === "yes") {
      market.yes_pool_sats += amount_sats;
    } else {
      market.no_pool_sats += amount_sats;
    }

    // Run matching
    const proposals = orderBook.matchOrders(id);
    const newPairs: MatchedBetPair[] = [];

    for (const proposal of proposals) {
      const yesEntry = orderProofs.get(proposal.yes_order_id);
      const noEntry = orderProofs.get(proposal.no_order_id);

      // If both sides have real Cashu proofs, create cross-HTLC tokens
      if (yesEntry && noEntry && yesEntry.proofs.length > 0 && noEntry.proofs.length > 0) {
        const swapDef: ConditionalSwapDef = {
          swap_id: id,
          hash_a: market.htlc_hash_yes,
          hash_b: market.htlc_hash_no,
          locktime: market.resolution_deadline,
        };
        const tokens = await createSwapPairTokens(
          yesEntry.proofs, noEntry.proofs,
          proposal.amount_sats, swapDef,
          yesEntry.pubkey, noEntry.pubkey,
        );
        if (tokens) {
          const pairId = generateId("pair");
          const pair: MatchedBetPair = {
            pair_id: pairId,
            market_id: id,
            yes_pubkey: yesEntry.pubkey,
            no_pubkey: noEntry.pubkey,
            amount_sats: proposal.amount_sats,
            token_yes_to_no: tokens.tokenAtoB.token,
            token_no_to_yes: tokens.tokenBtoA.token,
            status: "locked",
          };
          matchedPairsStore.set(pairId, pair);
          newPairs.push(pair);
          continue;
        }
      }

      // Fallback: record match without cross-HTLC (demo mode / no Cashu)
      const pairId = generateId("pair");
      const pair: MatchedBetPair = {
        pair_id: pairId,
        market_id: id,
        yes_pubkey: yesEntry?.pubkey ?? bettor_pubkey,
        no_pubkey: noEntry?.pubkey ?? bettor_pubkey,
        amount_sats: proposal.amount_sats,
        token_yes_to_no: "",
        token_no_to_yes: "",
        status: "locked",
      };
      matchedPairsStore.set(pairId, pair);
      newPairs.push(pair);
    }

    return c.json({
      order_id: orderId,
      side,
      amount_sats,
      cashu_locked: proofs.length > 0,
      matches: newPairs.map((p) => ({
        pair_id: p.pair_id,
        amount_sats: p.amount_sats,
        status: p.status,
        has_htlc: p.token_yes_to_no !== "",
      })),
      market: {
        yes_pool_sats: market.yes_pool_sats,
        no_pool_sats: market.no_pool_sats,
      },
    }, 201);
  });

  // -----------------------------------------------------------------------
  // POST /markets/:id/resolve — trigger oracle resolution
  // -----------------------------------------------------------------------

  mkt.post("/:id/resolve", writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    const market = markets.get(id);
    if (!market) return c.json({ error: "Market not found" }, 404);

    if (market.status !== "open" && market.status !== "closed") {
      return c.json({ error: `Market cannot be resolved (status: ${market.status})` }, 409);
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const outcome = typeof body.outcome === "string" ? body.outcome : "";
    if (outcome !== "yes" && outcome !== "no") {
      return c.json({ error: 'outcome must be "yes" or "no"' }, 400);
    }

    // Resolve via dual preimage store
    const result = resolveMarket(id, outcome, dualPreimageStore);
    if (!result) {
      return c.json({ error: "Resolution failed — preimage not found or already revealed" }, 500);
    }

    // Update market status
    const newStatus: MarketStatus = outcome === "yes" ? "resolved_yes" : "resolved_no";
    market.status = newStatus;

    // Update matched pairs
    for (const pair of matchedPairsStore.values()) {
      if (pair.market_id === id && pair.status === "locked") {
        pair.status = outcome === "yes" ? "settled_yes" : "settled_no";
      }
    }

    return c.json({
      market_id: id,
      outcome: result.outcome,
      preimage: result.preimage,
      status: newStatus,
      yes_pool_sats: market.yes_pool_sats,
      no_pool_sats: market.no_pool_sats,
    });
  });

  // -----------------------------------------------------------------------
  // GET /markets/:id/orders — open orders for a market
  // -----------------------------------------------------------------------

  mkt.get("/:id/orders", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    if (!markets.has(id)) return c.json({ error: "Market not found" }, 404);

    const side = c.req.query("side") as "yes" | "no" | undefined;
    const orders = orderBook.getOpenOrders(id, side);

    return c.json(
      orders.map((o) => ({
        id: o.id,
        side: o.side,
        amount_sats: o.amount_sats,
        remaining_sats: o.remaining_sats,
        bettor_pubkey: o.bettor_pubkey,
        timestamp: o.timestamp,
      })),
    );
  });

  app.route("/markets", mkt);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Clear all in-memory stores. Visible for testing. */
export function _clearMarketStoresForTest(): void {
  markets.clear();
  matchedPairsStore.clear();
  orderProofs.clear();
}
