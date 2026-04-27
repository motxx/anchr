/**
 * 巫(Kannagi) — Prediction Market HTTP route registration.
 *
 * All routes are under /markets/* and follow the registerXxxRoutes(app, ctx)
 * pattern from worker-api-routes.ts. In-memory market store + order book +
 * dual preimage store, wired into Hono.
 *
 * State is injectable via `MarketState` for testing. When no state is
 * provided, a lazily-constructed module-level state is reused.
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { Wallet, type Proof, getEncodedToken, getDecodedToken } from "@cashu/cashu-ts";
import type {
  PredictionMarket,
  OpenOrder,
  MatchedBetPair,
  MarketStatus,
} from "./market-types.ts";
import { createOrderBook, type OrderBook } from "./order-book.ts";
import {
  type DualKeyStore,
} from "@anchr/cashu-conditional-swap/frost-conditional-swap";
import {
  createAdaptiveDualKeyStore,
  frostDualKeySignAsync,
  frostSignProofSecretsAsync,
} from "@anchr/cashu-conditional-swap/frost-dual-key-store";
import { loadMarketFrostNodeConfig, type MarketFrostNodeConfig } from "@anchr/cashu-frost-oracle/market-frost-config";
import { signRound1, signRound2 } from "@anchr/cashu-frost-oracle/frost-cli";
import { resolveMarket } from "./resolution.ts";
import { evaluateCondition, OracleError, verifyMarketResolution } from "./market-oracle.ts";
import { settleMarket } from "./market-settlement.ts";
import {
  createDualPreimageStore,
  type DualPreimageStore,
} from "@anchr/cashu-conditional-swap/dual-preimage-store";
import {
  isMintReachable,
  mintProofsFromRegtest,
} from "./market-wallet.ts";
import { verifyReceivedToken } from "./exchange-protocol.ts";
import { publishMarket, type MarketIdentity } from "./nostr-market.ts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { hexToBytes } from "@noble/hashes/utils.js";
import { validateTruthSourceUrl } from "./url-guard.ts";

/**
 * Minimum window between market creation and the resolution deadline.
 * Prevents an attacker from creating a market with deadline=0 to trigger
 * an immediate auto-resolver fetch with no betting window. Also bounds
 * the worst case for the SSRF defenses below: an attacker creates a
 * malicious URL, but at least N seconds must pass before any fetch.
 *
 * Override with MIN_MARKET_LIFETIME_SECS for tests / dev.
 */
function minMarketLifetimeSecs(): number {
  const raw = Deno.env.get("MIN_MARKET_LIFETIME_SECS");
  const n = raw ? Number(raw) : 60;
  return Number.isFinite(n) && n >= 0 ? n : 60;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketRouteContext {
  writeAuth: MiddlewareHandler;
  rateLimit: MiddlewareHandler;
}

// ---------------------------------------------------------------------------
// MarketState — injectable for testing
// ---------------------------------------------------------------------------

/** All mutable state for the prediction market API. */
export interface MarketState {
  markets: Map<string, PredictionMarket>;
  matchedPairs: Map<string, MatchedBetPair>;
  resolvedPreimages: Map<string, string>;
  resolvedSignatures: Map<string, string>;
  /**
   * Per-proof oracle signatures for NUT-11 P2PK redemption.
   * Outer map: marketId -> inner map: proofSecret -> hex signature.
   */
  resolvedProofSignatures: Map<string, Map<string, string>>;
  /**
   * Pending exchange tokens submitted by users.
   * Key: pair_id + "_" + side ("yes" | "no"), Value: cashuB token string.
   * Server verifies P2PK conditions but cannot spend (enforced by P2PK).
   */
  pendingExchangeTokens: Map<string, string>;
  dualPreimageStore: DualPreimageStore;
  dualKeyStore: DualKeyStore;
  orderBook: OrderBook;
  frostMode: "frost" | "single-key";
  frostConfig?: MarketFrostNodeConfig;
  /** Override for getCashuWallet — tests can inject a mock. */
  getCashuWallet?: () => Promise<Wallet | null>;
  /** Nostr identity used to sign published market events. */
  nostrIdentity?: MarketIdentity;
  /** Relays to publish new markets to. Empty array = publish disabled. */
  nostrRelays: string[];
  /**
   * Override for the Nostr publish call. Tests inject a mock so they can
   * assert publish was called without spinning up a relay.
   */
  publishMarket?: (
    market: PredictionMarket,
    identity: MarketIdentity,
    relayUrls: string[],
  ) => Promise<string>;
}

/** Create a fresh MarketState. Used for tests and as default state. */
export function createMarketState(opts?: {
  frostConfig?: MarketFrostNodeConfig;
  nostrIdentity?: MarketIdentity;
  nostrRelays?: string[];
  publishMarket?: MarketState["publishMarket"];
}): MarketState {
  const { store: dualKeyStore, mode: frostMode } = createAdaptiveDualKeyStore(opts?.frostConfig);
  return {
    markets: new Map(),
    matchedPairs: new Map(),
    resolvedPreimages: new Map(),
    resolvedSignatures: new Map(),
    resolvedProofSignatures: new Map(),
    pendingExchangeTokens: new Map(),
    dualPreimageStore: createDualPreimageStore(),
    dualKeyStore,
    orderBook: createOrderBook(),
    frostMode,
    frostConfig: opts?.frostConfig,
    nostrIdentity: opts?.nostrIdentity,
    nostrRelays: opts?.nostrRelays ?? [],
    publishMarket: opts?.publishMarket,
  };
}

/**
 * Resolve the Nostr publishing identity from environment.
 *
 * NOSTR_MARKET_SECRET_KEY (hex, 64 chars) — pinned identity for repeated
 *   restarts so consumers can filter by author.
 * If unset, generate an ephemeral keypair and log the pubkey so the
 *   operator can pin it later. Markets created in this run will all share
 *   that ephemeral key.
 */
function resolveNostrIdentity(): MarketIdentity {
  const hex = Deno.env.get("NOSTR_MARKET_SECRET_KEY")?.trim();
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    const secretKey = hexToBytes(hex);
    return { secretKey, pubkey: getPublicKey(secretKey) };
  }
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  console.warn(
    `[market] NOSTR_MARKET_SECRET_KEY not set — generated ephemeral keypair (pubkey=${pubkey.slice(0, 16)}...). ` +
    `Markets will be unsigned-by-this-server after restart. Pin the key with NOSTR_MARKET_SECRET_KEY=<hex>.`,
  );
  return { secretKey, pubkey };
}

function resolveNostrRelays(): string[] {
  const raw = Deno.env.get("NOSTR_RELAYS")?.trim();
  if (!raw) return [];
  return raw.split(",").map((url) => url.trim()).filter((url) => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
        console.warn(`[market] dropping non-ws(s) relay URL: ${url}`);
        return false;
      }
      return true;
    } catch {
      console.warn(`[market] dropping malformed relay URL: ${url}`);
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Default module-level state — lazy, reused when no MarketState is injected.
// ---------------------------------------------------------------------------

let _defaultState: MarketState | null = null;

function getDefaultState(): MarketState {
  if (_defaultState) return _defaultState;

  let marketFrostConfig: MarketFrostNodeConfig | undefined;
  try {
    const configPath = Deno.env.get("FROST_MARKET_CONFIG_PATH");
    if (configPath) {
      marketFrostConfig = loadMarketFrostNodeConfig(configPath);
      console.log(`[market] FROST market config loaded from ${configPath}`);
      console.log(`[market] FROST ${marketFrostConfig.threshold}-of-${marketFrostConfig.total_signers}`);
      console.log(`[market] YES group: ${marketFrostConfig.group_pubkey.slice(0, 16)}...`);
      console.log(`[market] NO  group: ${marketFrostConfig.group_pubkey_no.slice(0, 16)}...`);
    }
  } catch { /* FROST not configured — single-key mode */ }

  const nostrIdentity = resolveNostrIdentity();
  const nostrRelays = resolveNostrRelays();
  if (nostrRelays.length > 0) {
    console.log(`[market] Nostr publishing enabled — pubkey=${nostrIdentity.pubkey.slice(0, 16)}... relays=${nostrRelays.length}`);
  } else {
    console.log(`[market] Nostr publishing disabled — set NOSTR_RELAYS=ws://... to enable.`);
  }

  _defaultState = createMarketState({
    frostConfig: marketFrostConfig,
    nostrIdentity,
    nostrRelays,
  });
  console.log(`[market] Resolution mode: ${_defaultState.frostMode}`);
  return _defaultState;
}

// Cashu wallet — initialized lazily when CASHU_MINT_URL is set
let _cashuWallet: Wallet | null = null;
async function getCashuWalletDefault(): Promise<Wallet | null> {
  const mintUrl = Deno.env.get("CASHU_MINT_URL");
  if (!mintUrl) return null;
  if (_cashuWallet) return _cashuWallet;
  try {
    _cashuWallet = new Wallet(mintUrl, { unit: "sat" });
    await _cashuWallet.loadMint();
    return _cashuWallet;
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

function marketSummary(m: PredictionMarket, state: MarketState) {
  const orders = Array.from(state.matchedPairs.values()).filter((p) => p.market_id === m.id);
  const preimage = state.resolvedPreimages.get(m.id);
  const oracleSignature = state.resolvedSignatures.get(m.id);
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    category: m.category,
    status: m.status,
    yes_pool_sats: m.yes_pool_sats,
    no_pool_sats: m.no_pool_sats,
    resolution_url: m.resolution_url,
    resolution_condition: m.resolution_condition,
    resolution_deadline: m.resolution_deadline,
    min_bet_sats: m.min_bet_sats,
    max_bet_sats: m.max_bet_sats,
    fee_ppm: m.fee_ppm,
    oracle_pubkey: m.oracle_pubkey,
    creator_pubkey: m.creator_pubkey,
    htlc_hash_yes: m.htlc_hash_yes,
    htlc_hash_no: m.htlc_hash_no,
    group_pubkey_yes: m.group_pubkey_yes,
    group_pubkey_no: m.group_pubkey_no,
    volume_sats: m.yes_pool_sats + m.no_pool_sats,
    num_bettors: orders.length * 2,
    created_at: Math.floor(Date.now() / 1000),
    nostr_event_id: m.nostr_event_id,
    ...(preimage ? { resolved_preimage: preimage } : {}),
    ...(oracleSignature ? { oracle_signature: oracleSignature } : {}),
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export function registerMarketRoutes(app: Hono<any>, ctx: MarketRouteContext, injectedState?: MarketState): void {
  const { writeAuth, rateLimit } = ctx;
  const s = injectedState ?? getDefaultState();
  const getWallet = s.getCashuWallet ?? getCashuWalletDefault;
  const mkt = new Hono();

  // -----------------------------------------------------------------------
  // GET /markets — list all markets (optional ?category= filter)
  // -----------------------------------------------------------------------

  mkt.get("/", (c) => {
    const category = c.req.query("category");
    let list = Array.from(s.markets.values());
    if (category) {
      list = list.filter((m) => m.category === category);
    }
    return c.json(list.map((m) => marketSummary(m, s)));
  });

  // -----------------------------------------------------------------------
  // POST /markets/wallet/faucet — mint tokens and return cashuB string
  //
  // Non-custodial: the server mints proofs via regtest Lightning but
  // returns a cashuB token string to the client. The client swaps it
  // at the mint to take ownership. Server never holds the user's balance.
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // GET /markets/wallet/config — public mint URL the browser should connect to
  //
  // The browser-side Cashu wallet (ui/wallet.ts) calls this on load to
  // discover the mint without an env var. Returns mint_url=null when the
  // server has no wallet configured (e.g. demo/manual mode).
  // -----------------------------------------------------------------------

  mkt.get("/wallet/config", (c) => {
    const mintUrl = Deno.env.get("CASHU_MINT_URL") ?? null;
    // Surface the same relay set the server publishes markets to. The
    // browser-side NIP-60 wallet uses these to persist Cashu proofs as
    // encrypted kind:7375 token events.
    return c.json({ mint_url: mintUrl, nostr_relays: s.nostrRelays });
  });

  mkt.post("/wallet/faucet", rateLimit, async (c) => {
    const wallet = await getWallet();
    if (!wallet) {
      return c.json(
        { error: "Cashu mint not configured — set CASHU_MINT_URL and run docker compose up -d" },
        503,
      );
    }

    const mintUrl = Deno.env.get("CASHU_MINT_URL")!;
    const reachable = await isMintReachable(mintUrl);
    if (!reachable) {
      return c.json(
        { error: "Cashu mint not reachable — ensure docker compose is running" },
        503,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const amount_sats = typeof body.amount_sats === "number" ? body.amount_sats : 1000;
    if (amount_sats <= 0) return c.json({ error: "amount_sats must be positive" }, 400);

    try {
      const proofs = await mintProofsFromRegtest(wallet, amount_sats);
      const cashu_token = getEncodedToken({ mint: mintUrl, proofs });
      return c.json({
        cashu_token,
        amount_sats,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[market-faucet] Mint failed:", msg);
      return c.json({ error: `Faucet mint failed: ${msg}` }, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /markets/:id — market detail
  // -----------------------------------------------------------------------

  mkt.get("/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);
    const market = s.markets.get(id);
    if (!market) return c.json({ error: "Market not found" }, 404);

    const openOrders = s.orderBook.getOpenOrders(id);
    const matchedPairs = Array.from(s.matchedPairs.values()).filter((b) => b.market_id === id);

    // If a pubkey is provided, include that user's matched pairs with win status
    const queryPubkey = c.req.query("pubkey");
    const userPairs = queryPubkey
      ? matchedPairs
          .filter((p) => p.yes_pubkey === queryPubkey || p.no_pubkey === queryPubkey)
          .map((p) => {
            const userSide = p.yes_pubkey === queryPubkey ? "yes" : "no";
            const counterpartyPubkey = userSide === "yes" ? p.no_pubkey : p.yes_pubkey;
            const won =
              (market.status === "resolved_yes" && userSide === "yes") ||
              (market.status === "resolved_no" && userSide === "no");
            return {
              pair_id: p.pair_id,
              side: userSide,
              counterparty_pubkey: counterpartyPubkey,
              amount_sats: p.amount_sats,
              status: p.status,
              won,
              token: won
                ? (userSide === "yes" ? p.token_no_to_yes : p.token_yes_to_no)
                : undefined,
            };
          })
      : undefined;

    return c.json({
      ...marketSummary(market, s),
      resolution_url: market.resolution_url,
      resolution_condition: market.resolution_condition,
      oracle_pubkey: market.oracle_pubkey,
      creator_pubkey: market.creator_pubkey,
      open_orders: openOrders.length,
      matched_pairs: matchedPairs.length,
      ...(userPairs ? { user_pairs: userPairs } : {}),
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

    // SSRF guard: anyone can create a market, so the resolution_url is an
    // attacker-influenced URL the server's auto-resolver will fetch later.
    // Reject http(s) URLs that point at loopback/private/link-local hosts,
    // URLs with embedded credentials, and non-http(s) schemes.
    const urlError = validateTruthSourceUrl(resolution_url);
    if (urlError) {
      return c.json({ error: `resolution_url: ${urlError}` }, 400);
    }

    // Minimum betting window — prevents instant auto-resolution.
    const nowSecs = Math.floor(Date.now() / 1000);
    const minLife = minMarketLifetimeSecs();
    if (resolution_deadline < nowSecs + minLife) {
      return c.json({
        error: `resolution_deadline must be at least ${minLife}s in the future`,
      }, 400);
    }

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

    // SSRF guard for the condition target URL too (defense in depth — usually
    // identical to resolution_url, but the schema permits it to differ).
    if (resolution_condition.target_url !== resolution_url) {
      const targetError = validateTruthSourceUrl(resolution_condition.target_url);
      if (targetError) {
        return c.json({ error: `resolution_condition.target_url: ${targetError}` }, 400);
      }
    }

    // Validate resolution condition
    const ct = resolution_condition.type;
    if ((ct === "jsonpath_gt" || ct === "jsonpath_lt" || ct === "price_above" || ct === "price_below") && resolution_condition.threshold === undefined) {
      return c.json({ error: `resolution_condition.threshold is required for type "${ct}"` }, 400);
    }
    if ((ct === "jsonpath_gt" || ct === "jsonpath_lt" || ct === "jsonpath_equals") && !resolution_condition.jsonpath) {
      return c.json({ error: `resolution_condition.jsonpath is required for type "${ct}"` }, 400);
    }
    if ((ct === "contains_text" || ct === "jsonpath_equals") && !resolution_condition.expected_text) {
      return c.json({ error: `resolution_condition.expected_text is required for type "${ct}"` }, 400);
    }

    // Generate market ID, dual preimage pair (HTLC fallback), and FROST keypairs
    const id = generateId("mkt");
    const hashes = s.dualPreimageStore.create(id);
    const frostKeys = s.dualKeyStore.create(id);

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
      htlc_hash_yes: hashes.hash_a, // outcome A = YES (HTLC fallback)
      htlc_hash_no: hashes.hash_b,  // outcome B = NO  (HTLC fallback)
      group_pubkey_yes: frostKeys.pubkey_a, // FROST P2PK: outcome A = YES
      group_pubkey_no: frostKeys.pubkey_b,  // FROST P2PK: outcome B = NO
      nostr_event_id: "",
      status: "open",
    };

    s.markets.set(id, market);

    // Publish to Nostr (best-effort; failure is logged, not blocking).
    // The market is queryable via HTTP regardless; Nostr publication makes
    // it discoverable to off-server clients.
    if (s.nostrIdentity && s.nostrRelays.length > 0) {
      const publishFn = s.publishMarket ?? publishMarket;
      try {
        const eventId = await publishFn(market, s.nostrIdentity, s.nostrRelays);
        market.nostr_event_id = eventId;
      } catch (err) {
        console.warn(`[market] Nostr publish failed for ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return c.json(marketSummary(market, s), 201);
  });

  // -----------------------------------------------------------------------
  // POST /markets/:id/bet — place a bet (YES or NO)
  // -----------------------------------------------------------------------

  mkt.post("/:id/bet", rateLimit, writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    const market = s.markets.get(id);
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

    // Add order to the book — matchmaker only, no token handling
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
    s.orderBook.addOrder(order);

    // Update market pool totals
    if (side === "yes") {
      market.yes_pool_sats += amount_sats;
    } else {
      market.no_pool_sats += amount_sats;
    }

    // Snapshot order pubkeys BEFORE matching (matching may zero remaining_sats)
    const allYes = s.orderBook.getOpenOrders(id, "yes");
    const allNo = s.orderBook.getOpenOrders(id, "no");
    const orderPubkeys = new Map<string, string>();
    for (const o of [...allYes, ...allNo]) {
      orderPubkeys.set(o.id, o.bettor_pubkey);
    }

    // Run matching — pure announcement, no token creation
    const proposals = s.orderBook.matchOrders(id);
    const newPairs: MatchedBetPair[] = [];

    // Compute locktimes for the match response
    const now = Math.floor(Date.now() / 1000);
    const exchangeLocktime = now + 600; // 10 min for P2P exchange
    const marketLocktime = market.resolution_deadline + 3600; // deadline + 1h buffer

    for (const proposal of proposals) {
      const yesPubkey = orderPubkeys.get(proposal.yes_order_id) ?? bettor_pubkey;
      const noPubkey = orderPubkeys.get(proposal.no_order_id) ?? bettor_pubkey;

      const pairId = generateId("pair");
      const pair: MatchedBetPair = {
        pair_id: pairId,
        market_id: id,
        yes_pubkey: yesPubkey,
        no_pubkey: noPubkey,
        amount_sats: proposal.amount_sats,
        // Tokens start empty — users create and submit them via exchange protocol
        token_yes_to_no: "",
        token_no_to_yes: "",
        status: "pending",
      };
      s.matchedPairs.set(pairId, pair);
      newPairs.push(pair);
    }

    // Pure matchmaker response: announce matches with info needed to create tokens
    return c.json({
      order_id: orderId,
      side,
      amount_sats,
      matches: newPairs.map((p) => ({
        pair_id: p.pair_id,
        counterparty_pubkey: side === "yes" ? p.no_pubkey : p.yes_pubkey,
        group_pubkey_yes: market.group_pubkey_yes ?? "",
        group_pubkey_no: market.group_pubkey_no ?? "",
        locktime_exchange: exchangeLocktime,
        locktime_market: marketLocktime,
        amount_sats: p.amount_sats,
      })),
      market: {
        yes_pool_sats: market.yes_pool_sats,
        no_pool_sats: market.no_pool_sats,
      },
    }, 201);
  });

  // -----------------------------------------------------------------------
  // POST /markets/:id/submit-token — submit P2PK-locked token for a match
  //
  // Non-custodial relay: the server VERIFIES token conditions but cannot
  // spend them (P2PK enforce). When both sides submit, server distributes.
  // -----------------------------------------------------------------------

  mkt.post("/:id/submit-token", rateLimit, writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    const market = s.markets.get(id);
    if (!market) return c.json({ error: "Market not found" }, 404);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const pair_id = typeof body.pair_id === "string" ? body.pair_id : "";
    const cashu_token = typeof body.cashu_token === "string" ? body.cashu_token : "";
    const bettor_pubkey = typeof body.bettor_pubkey === "string" ? body.bettor_pubkey : "";

    if (!pair_id) return c.json({ error: "pair_id is required" }, 400);
    if (!cashu_token) return c.json({ error: "cashu_token is required" }, 400);
    if (!bettor_pubkey) return c.json({ error: "bettor_pubkey is required" }, 400);

    const pair = s.matchedPairs.get(pair_id);
    if (!pair || pair.market_id !== id) {
      return c.json({ error: "Matched pair not found" }, 404);
    }

    // Determine which side this bettor is
    let side: "yes" | "no";
    if (pair.yes_pubkey === bettor_pubkey) {
      side = "yes";
    } else if (pair.no_pubkey === bettor_pubkey) {
      side = "no";
    } else {
      return c.json({ error: "You are not part of this matched pair" }, 403);
    }

    // Determine the expected group pubkey for verification:
    // YES bettor's token is locked to [group_no, no_pubkey] (redeemable by NO if NO wins)
    // NO bettor's token is locked to [group_yes, yes_pubkey] (redeemable by YES if YES wins)
    const expectedGroupPubkey = side === "yes"
      ? (market.group_pubkey_no ?? "")
      : (market.group_pubkey_yes ?? "");
    const expectedCounterpartyPubkey = side === "yes" ? pair.no_pubkey : pair.yes_pubkey;

    // Verify the token has correct P2PK conditions.
    // Only verify if token looks like a real cashuB token (decodes successfully).
    // In demo mode (no Cashu mint), tokens may be placeholder strings.
    if (expectedGroupPubkey && cashu_token.startsWith("cashuB")) {
      try {
        const decoded = getDecodedToken(cashu_token);
        if (decoded.proofs && decoded.proofs.length > 0) {
          const verification = verifyReceivedToken(cashu_token, {
            groupPubkey: expectedGroupPubkey,
            myPubkey: expectedCounterpartyPubkey,
            amount: pair.amount_sats,
            minLocktime: market.resolution_deadline,
          });

          if (!verification.valid) {
            return c.json({ error: `Token verification failed: ${verification.error}` }, 400);
          }
        }
      } catch {
        // Token doesn't decode as cashuB — demo mode, accept without deep verification
      }
    }

    // Store the token
    const tokenKey = `${pair_id}_${side}`;
    s.pendingExchangeTokens.set(tokenKey, cashu_token);

    // Check if both sides have submitted
    const yesToken = s.pendingExchangeTokens.get(`${pair_id}_yes`);
    const noToken = s.pendingExchangeTokens.get(`${pair_id}_no`);

    if (yesToken && noToken) {
      // Both tokens received — distribute and lock the pair
      pair.token_yes_to_no = yesToken;
      pair.token_no_to_yes = noToken;
      pair.status = "locked";

      // Clean up pending tokens
      s.pendingExchangeTokens.delete(`${pair_id}_yes`);
      s.pendingExchangeTokens.delete(`${pair_id}_no`);

      return c.json({
        pair_id,
        status: "locked",
        // Each bettor receives the counterparty's token (that they can redeem if they win)
        redeemable_token: side === "yes" ? noToken : yesToken,
        message: "Exchange complete — both tokens locked",
      });
    }

    return c.json({
      pair_id,
      status: "pending",
      message: "Token submitted — waiting for counterparty",
    });
  });

  // -----------------------------------------------------------------------
  // POST /markets/:id/resolve — trigger oracle resolution
  // -----------------------------------------------------------------------

  mkt.post("/:id/resolve", writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

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

    const verifiedBody = typeof body.verified_body === "string" ? body.verified_body : undefined;
    const result = await settleMarket(s, id, outcome, { verifiedBody });
    if (!result.ok) {
      return c.json({ error: result.error, ...(result.mode ? { mode: result.mode } : {}) }, result.status as 400 | 404 | 409 | 500 | 503);
    }
    return c.json({
      market_id: result.market_id,
      outcome: result.outcome,
      ...(result.oracle_signature ? { oracle_signature: result.oracle_signature } : {}),
      ...(result.preimage ? { preimage: result.preimage } : {}),
      ...(result.proof_signatures_count !== undefined ? { proof_signatures_count: result.proof_signatures_count } : {}),
      mode: result.mode,
      status: result.status,
      yes_pool_sats: result.yes_pool_sats,
      no_pool_sats: result.no_pool_sats,
      settled_pairs: result.settled_pairs,
    });
  });

  // -----------------------------------------------------------------------
  // POST /markets/:id/submit-resolution — anyone can submit a TLSNotary
  // proof of the truth source's response. The server cryptographically
  // verifies the proof, evaluates the condition against the verified body,
  // and settles the market. This is the trustless settlement path: no one
  // — not even the server operator — needs to be trusted to read the URL
  // honestly.
  //
  // Race semantics: first valid proof wins. The cryptographic binding is
  // (server name, response body, session timestamp); a proof captured at
  // any moment after the resolution deadline can settle the market, with
  // freshness bounded by the verifier's max-age check (default 10 min).
  // This is deliberate — early observers commit the market to one outcome
  // and concurrent submissions for the same market hit the state-machine
  // 409 from settleMarket. Operators that want a wider observation window
  // can adjust max_age_seconds per request.
  // -----------------------------------------------------------------------

  mkt.post("/:id/submit-resolution", rateLimit, writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    const market = s.markets.get(id);
    if (!market) return c.json({ error: "Market not found" }, 404);

    // Bound the request body. TLSNotary presentations are typically <100 KiB
    // base64; 1 MiB leaves room for headers, encoded server certs, and slack.
    const MAX_BODY_BYTES = 1_048_576;
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return c.json({ error: "request body too large" }, 413);
    }
    const rawBody = await c.req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return c.json({ error: "request body too large" }, 413);
    }
    let body: { tlsn_presentation?: unknown; max_age_seconds?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (typeof body.tlsn_presentation !== "string" || !body.tlsn_presentation) {
      return c.json({ error: "tlsn_presentation is required (base64-encoded TLSNotary presentation)" }, 400);
    }
    // Sanity-check: base64 alphabet + reasonable length. Real presentations
    // are tens of KiB; we cap an order of magnitude above expected to leave
    // headroom for future format expansion without becoming a DoS vector.
    if (!/^[A-Za-z0-9+/=\s]{16,1500000}$/.test(body.tlsn_presentation)) {
      return c.json({ error: "tlsn_presentation must be base64 (16..1.5e6 chars)" }, 400);
    }
    const maxAgeSeconds = typeof body.max_age_seconds === "number" ? body.max_age_seconds : undefined;

    let verified;
    try {
      verified = await verifyMarketResolution(market, body.tlsn_presentation, { maxAgeSeconds });
    } catch (err) {
      const message = err instanceof OracleError
        ? err.message
        : err instanceof Error
        ? err.message
        : "TLSNotary verification failed";
      return c.json({ error: message }, 400);
    }

    const settled = await settleMarket(s, id, verified.outcome, {
      verifiedBody: verified.verifiedBody,
    });
    if (!settled.ok) {
      return c.json({ error: settled.error, ...(settled.mode ? { mode: settled.mode } : {}) }, settled.status as 400 | 404 | 409 | 500 | 503);
    }

    return c.json({
      market_id: settled.market_id,
      outcome: settled.outcome,
      mode: settled.mode,
      status: settled.status,
      tlsn: {
        verified_server_name: verified.verifiedServerName,
        verified_timestamp: verified.verifiedTimestamp,
        verified_body_length: verified.verifiedBody.length,
      },
      ...(settled.oracle_signature ? { oracle_signature: settled.oracle_signature } : {}),
      ...(settled.preimage ? { preimage: settled.preimage } : {}),
      ...(settled.proof_signatures_count !== undefined ? { proof_signatures_count: settled.proof_signatures_count } : {}),
      yes_pool_sats: settled.yes_pool_sats,
      no_pool_sats: settled.no_pool_sats,
      settled_pairs: settled.settled_pairs,
    });
  });

  // -----------------------------------------------------------------------
  // POST /markets/:id/redeem — client-side redemption of winning HTLC tokens
  // -----------------------------------------------------------------------

  mkt.post("/:id/redeem", rateLimit, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    const market = s.markets.get(id);
    if (!market) return c.json({ error: "Market not found" }, 404);

    const isResolved = market.status === "resolved_yes" || market.status === "resolved_no";
    if (!isResolved) {
      return c.json({ error: `Market is not resolved (status: ${market.status})` }, 409);
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const pubkey = typeof body.pubkey === "string" ? body.pubkey.trim() : "";
    if (!pubkey) return c.json({ error: "pubkey is required" }, 400);

    const preimage = s.resolvedPreimages.get(id);
    const oracleSignature = s.resolvedSignatures.get(id);
    const proofSigMap = s.resolvedProofSignatures.get(id);

    if (!preimage && !oracleSignature && !proofSigMap) {
      return c.json({ error: "Resolution attestation not found — market may not be fully resolved" }, 500);
    }

    const outcome = market.status === "resolved_yes" ? "yes" : "no";

    // Non-custodial: the user already holds the counterparty's locked token
    // (received at match time). The redeem endpoint provides the Oracle's
    // per-proof signatures needed to satisfy NUT-11 P2PK spending conditions.
    // The user combines: locked_token + oracle_per_proof_signatures + own_signature → mint.

    const oraclePubkey = outcome === "yes" ? market.group_pubkey_yes : market.group_pubkey_no;

    // Collect winning pairs and per-proof oracle signatures for this user
    let winningPairCount = 0;
    let totalWinningSats = 0;
    const userOracleSignatures: Record<string, string> = {};

    for (const pair of s.matchedPairs.values()) {
      if (pair.market_id !== id) continue;
      const winnerPubkey = outcome === "yes" ? pair.yes_pubkey : pair.no_pubkey;
      if (winnerPubkey === pubkey) {
        winningPairCount++;
        totalWinningSats += pair.amount_sats;

        // Extract proof secrets from this user's redeemable token and collect signatures
        if (proofSigMap) {
          const redeemableToken = outcome === "yes" ? pair.token_no_to_yes : pair.token_yes_to_no;
          if (redeemableToken) {
            try {
              const decoded = getDecodedToken(redeemableToken);
              for (const proof of decoded.proofs) {
                const sig = proofSigMap.get(proof.secret);
                if (sig) {
                  userOracleSignatures[proof.secret] = sig;
                }
              }
            } catch {
              // Token may be empty in demo mode
            }
          }
        }
      }
    }

    const hasPerProofSigs = Object.keys(userOracleSignatures).length > 0;

    return c.json({
      outcome,
      winning_pairs: winningPairCount,
      total_winning_sats: totalWinningSats,
      // Per-proof oracle signatures for NUT-11 P2PK redemption:
      ...(hasPerProofSigs ? {
        oracle_signatures: userOracleSignatures,
        oracle_pubkey: oraclePubkey,
      } : {}),
      // Single market-level signature when per-proof signing didn't run
      // (e.g. demo path with no real proofs to sign).
      ...(oracleSignature && !hasPerProofSigs ? { oracle_signature: oracleSignature, oracle_pubkey: oraclePubkey } : {}),
      ...(preimage ? { preimage } : {}),
      // Instructions for NUT-11 P2PK redemption
      redeem_instructions: hasPerProofSigs
        ? "For each proof: set proof.witness = {signatures: [oracle_signatures[proof.secret], your_own_sig]}. Then swap at mint."
        : "Use wallet.receive(token, { privkey, preimage_or_signatures }) at the Cashu mint",
    });
  });

  // -----------------------------------------------------------------------
  // GET /markets/:id/orders — open orders for a market
  // -----------------------------------------------------------------------

  mkt.get("/:id/orders", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    if (!s.markets.has(id)) return c.json({ error: "Market not found" }, 404);

    const side = c.req.query("side") as "yes" | "no" | undefined;
    const orders = s.orderBook.getOpenOrders(id, side);

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

  // -----------------------------------------------------------------------
  // POST /markets/:id/sign-proofs — client submits proof secrets for Oracle signing
  //
  // Non-custodial: the client holds their locked tokens. At resolution time,
  // the client submits proof.secret values from their held token. The Oracle
  // signs SHA256(proof.secret) for each one with the winning outcome's key.
  // The client combines oracle_sig + own_sig to redeem at the mint.
  // -----------------------------------------------------------------------

  mkt.post("/:id/sign-proofs", rateLimit, writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    const market = s.markets.get(id);
    if (!market) return c.json({ error: "Market not found" }, 404);

    const isResolved = market.status === "resolved_yes" || market.status === "resolved_no";
    if (!isResolved) {
      return c.json({ error: `Market is not resolved (status: ${market.status})` }, 409);
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const proofSecrets = Array.isArray(body.proof_secrets) ? body.proof_secrets as string[] : [];
    const pubkey = typeof body.pubkey === "string" ? body.pubkey.trim() : "";

    if (proofSecrets.length === 0) return c.json({ error: "proof_secrets array is required" }, 400);
    if (!pubkey) return c.json({ error: "pubkey is required" }, 400);

    const outcome = market.status === "resolved_yes" ? "yes" : "no";
    const swapOutcome = outcome === "yes" ? "a" as const : "b" as const;

    // Verify the caller is actually a winner in a matched pair
    let isWinner = false;
    for (const pair of s.matchedPairs.values()) {
      if (pair.market_id !== id) continue;
      const winnerPubkey = outcome === "yes" ? pair.yes_pubkey : pair.no_pubkey;
      if (winnerPubkey === pubkey) {
        isWinner = true;
        break;
      }
    }
    if (!isWinner) {
      return c.json({ error: "Not a winner in this market" }, 403);
    }

    // Check if we already have signatures cached for this market
    let proofSigs = s.resolvedProofSignatures.get(id);

    // Filter to only sign secrets that haven't been signed yet
    const unseenSecrets = proofSigs
      ? proofSecrets.filter((s) => !proofSigs!.has(s))
      : proofSecrets;

    if (unseenSecrets.length > 0) {
      // Sign the unseen proof secrets
      let newSigs: Map<string, string> | null = null;

      if (s.frostMode === "frost" && s.frostConfig) {
        newSigs = await frostSignProofSecretsAsync(
          s.frostConfig,
          swapOutcome,
          unseenSecrets,
        );
      } else {
        newSigs = s.dualKeyStore.signProofSecrets(id, swapOutcome, unseenSecrets);
      }

      if (!newSigs) {
        return c.json({ error: "Signing failed — key may be unavailable" }, 503);
      }

      // Merge into existing map
      if (!proofSigs) {
        proofSigs = newSigs;
        s.resolvedProofSignatures.set(id, proofSigs);
      } else {
        for (const [k, v] of newSigs) {
          proofSigs.set(k, v);
        }
      }
    }

    // Collect signatures for the requested secrets
    const oracleSignatures: Record<string, string> = {};
    if (proofSigs) {
      for (const secret of proofSecrets) {
        const sig = proofSigs.get(secret);
        if (sig) {
          oracleSignatures[secret] = sig;
        }
      }
    }

    const oraclePubkey = outcome === "yes" ? market.group_pubkey_yes : market.group_pubkey_no;

    return c.json({
      outcome,
      oracle_pubkey: oraclePubkey,
      oracle_signatures: oracleSignatures,
      signed_count: Object.keys(oracleSignatures).length,
      total_requested: proofSecrets.length,
      redeem_instructions: "For each proof: set proof.witness = {signatures: [oracle_signatures[proof.secret], your_own_sig]}. Then swap at mint.",
    });
  });

  app.route("/markets", mkt);

  // --- FROST signer endpoints for market resolution (peer-to-peer signing) ---
  // signing-coordinator.ts calls /frost/signer/round1,2 on peer nodes.

  if (s.frostMode === "frost" && s.frostConfig) {
    const frostCfg = s.frostConfig;
    const pendingMarketNonces = new Map<string, { nonces: string; outcomeKey: "a" | "b" }>();

    app.post("/frost/signer/round1", writeAuth, async (c) => {
      const reqBody = await c.req.json<{
        message: string;
        query?: { id: string; resolution_url?: string };
        result?: { verified_body: string };
      }>().catch(() => null);
      if (!reqBody?.message || !frostCfg) {
        return c.json({ error: "Missing message or FROST not configured" }, 400);
      }

      // Parse "{marketId}:{outcome}" from the signing message
      const msgBytes = new Uint8Array(reqBody.message.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
      const msgText = new TextDecoder().decode(msgBytes);
      const [marketId, sigOutcome] = msgText.split(":");
      if (!marketId || (sigOutcome !== "yes" && sigOutcome !== "no")) {
        return c.json({ error: `Cannot parse message: ${msgText}` }, 400);
      }

      // Independent condition evaluation (the security guarantee)
      if (reqBody.result?.verified_body) {
        const mkt = s.markets.get(marketId);
        if (mkt?.resolution_condition) {
          const condMet = evaluateCondition(mkt.resolution_condition, reqBody.result.verified_body);
          if ((condMet ? "yes" : "no") !== sigOutcome) {
            return c.json({ error: "Condition evaluation disagrees" }, 403);
          }
        }
      }

      const outcomeKey = sigOutcome === "yes" ? "a" as const : "b" as const;
      const keyPkg = outcomeKey === "a" ? frostCfg.key_package : frostCfg.key_package_no;
      
      const r1 = await signRound1(JSON.stringify(keyPkg));
      if (!r1.ok) return c.json({ error: r1.error }, 500);

      const nonceId = crypto.randomUUID();
      pendingMarketNonces.set(nonceId, { nonces: JSON.stringify(r1.data!.nonces), outcomeKey });
      return c.json({ commitments: r1.data!.commitments, nonce_id: nonceId });
    });

    app.post("/frost/signer/round2", writeAuth, async (c) => {
      const reqBody = await c.req.json<{ commitments: string; message: string; nonce_id: string }>().catch(() => null);
      if (!reqBody?.commitments || !reqBody?.message || !reqBody?.nonce_id || !frostCfg) {
        return c.json({ error: "Missing fields" }, 400);
      }
      const stored = pendingMarketNonces.get(reqBody.nonce_id);
      if (!stored) return c.json({ error: "Unknown nonce_id" }, 409);
      pendingMarketNonces.delete(reqBody.nonce_id);

      const keyPkg = stored.outcomeKey === "a" ? frostCfg.key_package : frostCfg.key_package_no;
      
      const r2 = await signRound2(JSON.stringify(keyPkg), stored.nonces, reqBody.commitments, reqBody.message);
      if (!r2.ok) return c.json({ error: r2.error }, 500);
      return c.json({ signature_share: r2.data!.signature_share });
    });

    console.log("[market] FROST signer endpoints registered (/frost/signer/round1,2)");
  }
}

