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
import { Wallet, type Proof, getEncodedToken, getDecodedToken } from "@cashu/cashu-ts";
import type {
  PredictionMarket,
  OpenOrder,
  MatchedBetPair,
  MatchProposal,
  MarketStatus,
} from "../../example/prediction-market/src/market-types.ts";
import { createOrderBook, type OrderBook } from "../../example/prediction-market/src/order-book.ts";
import { buildCrossHtlcForPartyA, buildCrossHtlcForPartyB } from "./conditional-swap/cross-htlc.ts";
import {
  buildFrostSwapForPartyA,
  buildFrostSwapForPartyB,
  type DualKeyStore,
} from "./conditional-swap/frost-conditional-swap.ts";
import {
  createAdaptiveDualKeyStore,
  frostDualKeySignAsync,
} from "./conditional-swap/frost-dual-key-store.ts";
import { loadMarketFrostNodeConfig, type MarketFrostNodeConfig } from "./frost/market-frost-config.ts";
import { resolveMarket } from "../../example/prediction-market/src/resolution.ts";
import { evaluateCondition } from "../../example/prediction-market/src/market-oracle.ts";
import {
  createDualPreimageStore,
  type DualPreimageStore,
} from "./conditional-swap/dual-preimage-store.ts";
import type { ConditionalSwapDef, FrostConditionalSwapDef } from "../domain/conditional-swap-types.ts";
import { spawn } from "../runtime/mod.ts";
import { hexToBytes } from "@noble/hashes/utils.js";

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

// Load FROST market config if available (for multi-Oracle threshold signing)
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

const { store: dualKeyStore, mode: frostMode } = createAdaptiveDualKeyStore(marketFrostConfig);
console.log(`[market] Resolution mode: ${frostMode}`);

const orderBook: OrderBook = createOrderBook();
/** Map orderId → { pubkey, proofs } for cross-HTLC execution */
const orderProofs = new Map<string, { pubkey: string; proofs: Proof[] }>();
/** Map marketId → winning preimage (stored after resolution for client-side redemption, HTLC mode) */
const resolvedPreimages = new Map<string, string>();
/** Map marketId → oracle signature (stored after resolution, FROST P2PK mode) */
const resolvedSignatures = new Map<string, string>();

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
// Per-user proof storage (pubkey → Proof[])
// ---------------------------------------------------------------------------

const userProofs = new Map<string, Proof[]>();

/** Get user balance from stored proofs. */
function getUserBalance(pubkey: string): number {
  const proofs = userProofs.get(pubkey) ?? [];
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

/** Append proofs to a user's balance. */
function creditUser(pubkey: string, proofs: Proof[]): void {
  const existing = userProofs.get(pubkey) ?? [];
  userProofs.set(pubkey, [...existing, ...proofs]);
}

/**
 * Deduct proofs from a user's balance. Uses wallet.send() to split
 * proofs to exact amount when an exact match is not available.
 * Returns the exact-amount proofs on success, or null on failure.
 */
async function debitUser(
  pubkey: string,
  amountSats: number,
  wallet: Wallet,
): Promise<Proof[] | null> {
  const proofs = userProofs.get(pubkey) ?? [];
  const balance = proofs.reduce((sum, p) => sum + p.amount, 0);
  if (balance < amountSats) return null;

  // Try exact combination first (greedy largest-first)
  const sorted = [...proofs].sort((a, b) => b.amount - a.amount);
  const selected: Proof[] = [];
  let selectedTotal = 0;
  for (const p of sorted) {
    if (selectedTotal >= amountSats) break;
    selected.push(p);
    selectedTotal += p.amount;
  }

  if (selectedTotal < amountSats) return null;

  if (selectedTotal === amountSats) {
    // Exact match — remove selected from user's store
    const remaining = proofs.filter(
      (p) => !selected.some((s) => s.C === p.C),
    );
    userProofs.set(pubkey, remaining);
    return selected;
  }

  // Need to split via mint — send exact amount, keep change
  try {
    await wallet.loadMint();
    const { send, keep } = await wallet.ops.send(amountSats, selected).run();
    // Remove the selected proofs and add back the change
    const remaining = proofs.filter(
      (p) => !selected.some((s) => s.C === p.C),
    );
    userProofs.set(pubkey, [...remaining, ...keep]);
    return send;
  } catch (err) {
    console.error(
      "[market-wallet] Failed to split proofs:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Check if the Cashu mint is reachable at the given URL. */
async function isMintReachable(mintUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${mintUrl}/v1/info`, {
      signal: AbortSignal.timeout(3000),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/** Pay a Lightning invoice via lnd-user docker container. */
async function payInvoiceViaLndUser(bolt11: string): Promise<boolean> {
  try {
    const proc = spawn(
      [
        "docker", "compose", "exec", "-T", "lnd-user",
        "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
        "payinvoice", "--force", bolt11,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Mint fresh Cashu proofs via regtest Lightning.
 * Creates a mint quote, pays the Lightning invoice via lnd-user, then
 * claims the proofs from the mint.
 */
async function mintProofsFromRegtest(
  wallet: Wallet,
  amountSats: number,
): Promise<Proof[]> {
  const mintQuote = await wallet.createMintQuote(amountSats);
  const paid = await payInvoiceViaLndUser(mintQuote.request);
  if (!paid) throw new Error("Failed to pay Lightning invoice via lnd-user");
  // Brief pause for mint to register the payment
  await new Promise((r) => setTimeout(r, 2000));
  return wallet.mintProofs(amountSats, mintQuote.quote);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function marketSummary(m: PredictionMarket) {
  const orders = Array.from(matchedPairsStore.values()).filter((p) => p.market_id === m.id);
  const preimage = resolvedPreimages.get(m.id);
  const oracleSignature = resolvedSignatures.get(m.id);
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
    htlc_hash: m.htlc_hash_yes,
    htlc_hash_yes: m.htlc_hash_yes,
    htlc_hash_no: m.htlc_hash_no,
    group_pubkey_yes: m.group_pubkey_yes,
    group_pubkey_no: m.group_pubkey_no,
    volume_sats: m.yes_pool_sats + m.no_pool_sats,
    num_bettors: orders.length * 2,
    created_at: Math.floor(Date.now() / 1000),
    ...(preimage ? { resolved_preimage: preimage } : {}),
    ...(oracleSignature ? { oracle_signature: oracleSignature } : {}),
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
  // GET /markets/wallet/balance — user balance from server-side proofs
  // -----------------------------------------------------------------------

  mkt.get("/wallet/balance", (c) => {
    const pubkey = c.req.query("pubkey");
    if (!pubkey) return c.json({ error: "pubkey query param is required" }, 400);
    return c.json({ pubkey, balance_sats: getUserBalance(pubkey) });
  });

  // -----------------------------------------------------------------------
  // POST /markets/wallet/faucet — mint tokens from regtest Lightning
  // -----------------------------------------------------------------------

  mkt.post("/wallet/faucet", rateLimit, async (c) => {
    const wallet = await getCashuWallet();
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

    const pubkey = typeof body.pubkey === "string" ? body.pubkey.trim() : "";
    const amount_sats = typeof body.amount_sats === "number" ? body.amount_sats : 1000;

    if (!pubkey) return c.json({ error: "pubkey is required" }, 400);
    if (amount_sats <= 0) return c.json({ error: "amount_sats must be positive" }, 400);

    try {
      const proofs = await mintProofsFromRegtest(wallet, amount_sats);
      creditUser(pubkey, proofs);
      return c.json({
        pubkey,
        funded_sats: amount_sats,
        balance_sats: getUserBalance(pubkey),
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
    const market = markets.get(id);
    if (!market) return c.json({ error: "Market not found" }, 404);

    const openOrders = orderBook.getOpenOrders(id);
    const matchedPairs = Array.from(matchedPairsStore.values()).filter((b) => b.market_id === id);

    // If a pubkey is provided, include that user's matched pairs with win status
    const queryPubkey = c.req.query("pubkey");
    const userPairs = queryPubkey
      ? matchedPairs
          .filter((p) => p.yes_pubkey === queryPubkey || p.no_pubkey === queryPubkey)
          .map((p) => {
            const userSide = p.yes_pubkey === queryPubkey ? "yes" : "no";
            const won =
              (market.status === "resolved_yes" && userSide === "yes") ||
              (market.status === "resolved_no" && userSide === "no");
            return {
              pair_id: p.pair_id,
              side: userSide,
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
      ...marketSummary(market),
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
    const hashes = dualPreimageStore.create(id);
    const frostKeys = dualKeyStore.create(id);

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

    // Resolve Cashu proofs: explicit token > server-side balance > demo mode
    let proofs: Proof[] = [];
    let proofSource: "token" | "balance" | "none" = "none";

    if (cashu_token) {
      // Path 1: Explicit Cashu token in request
      try {
        const decoded = getDecodedToken(cashu_token);
        proofs = decoded.proofs;
        const total = proofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);
        if (total < amount_sats) {
          return c.json({ error: `Cashu token has ${total} sats, need ${amount_sats}` }, 400);
        }
        proofSource = "token";
      } catch {
        return c.json({ error: "Invalid cashu_token" }, 400);
      }
    } else {
      // Path 2: Deduct from server-side user balance
      const wallet = await getCashuWallet();
      if (wallet && getUserBalance(bettor_pubkey) >= amount_sats) {
        const debited = await debitUser(bettor_pubkey, amount_sats, wallet);
        if (debited) {
          proofs = debited;
          proofSource = "balance";
        }
      }
      // Path 3: No proofs — demo mode (no Cashu), handled by fallback below
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

      // If both sides have real Cashu proofs, lock them with P2PK conditions.
      // FROST P2PK is preferred (2-of-2 multisig: group_pubkey + counterparty).
      // Falls back to HTLC hashlock if FROST keys are unavailable.
      if (yesEntry && noEntry && yesEntry.proofs.length > 0 && noEntry.proofs.length > 0) {
        try {
          const wallet = await getCashuWallet();
          if (wallet) {
            await wallet.loadMint();

            // Use FROST P2PK if group pubkeys are available, otherwise fall back to HTLC
            const useFrost = !!market.group_pubkey_yes && !!market.group_pubkey_no;

            let optionsAtoB, optionsBtoA;
            if (useFrost) {
              // FROST P2PK: lock to [group_pubkey, counterparty], n_sigs=2
              optionsAtoB = buildFrostSwapForPartyA({
                group_pubkey_b: market.group_pubkey_no!,
                counterpartyPubkey: noEntry.pubkey,
                refundPubkey: yesEntry.pubkey,
                locktime: market.resolution_deadline,
              });
              optionsBtoA = buildFrostSwapForPartyB({
                group_pubkey_a: market.group_pubkey_yes!,
                counterpartyPubkey: yesEntry.pubkey,
                refundPubkey: noEntry.pubkey,
                locktime: market.resolution_deadline,
              });
            } else {
              // HTLC fallback: hashlock + P2PK(counterparty)
              optionsAtoB = buildCrossHtlcForPartyA({
                hash_b: market.htlc_hash_no,
                counterpartyPubkey: noEntry.pubkey,
                refundPubkey: yesEntry.pubkey,
                locktime: market.resolution_deadline,
              });
              optionsBtoA = buildCrossHtlcForPartyB({
                hash_a: market.htlc_hash_yes,
                counterpartyPubkey: yesEntry.pubkey,
                refundPubkey: noEntry.pubkey,
                locktime: market.resolution_deadline,
              });
            }

            // Lock YES->NO: A's proofs locked with P2PK conditions
            // Proofs from debitUser are fresh plain proofs. We send them with P2PK conditions.
            // Use net amount after fees to avoid "Not enough funds" error.
            const yesTotal = yesEntry.proofs.reduce((s: number, p: Proof) => s + p.amount, 0);
            const yesFee = wallet.getFeesForProofs(yesEntry.proofs);
            const yesNet = yesTotal - yesFee;
            const { send: sendA, keep: keepA } = await wallet.ops.send(Math.min(proposal.amount_sats, yesNet), yesEntry.proofs).asP2PK(optionsAtoB).run();
            if (keepA.length > 0) creditUser(yesEntry.pubkey, keepA);

            // Lock NO->YES: B's proofs locked with P2PK conditions
            const noTotal = noEntry.proofs.reduce((s: number, p: Proof) => s + p.amount, 0);
            const noFee = wallet.getFeesForProofs(noEntry.proofs);
            const noNet = noTotal - noFee;
            const { send: sendB, keep: keepB } = await wallet.ops.send(Math.min(proposal.amount_sats, noNet), noEntry.proofs).asP2PK(optionsBtoA).run();
            if (keepB.length > 0) creditUser(noEntry.pubkey, keepB);

            const mintUrl = Deno.env.get("CASHU_MINT_URL") ?? "";
            const pairId = generateId("pair");
            const pair: MatchedBetPair = {
              pair_id: pairId,
              market_id: id,
              yes_pubkey: yesEntry.pubkey,
              no_pubkey: noEntry.pubkey,
              amount_sats: proposal.amount_sats,
              token_yes_to_no: getEncodedToken({ mint: mintUrl, proofs: sendA }),
              token_no_to_yes: getEncodedToken({ mint: mintUrl, proofs: sendB }),
              status: "locked",
            };
            matchedPairsStore.set(pairId, pair);
            newPairs.push(pair);
            continue;
          }
        } catch (err) {
          console.error(`[market] P2PK token creation failed, falling back to demo mode:`, err);
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
      proof_source: proofSource,
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

    // Determine resolution mode: FROST P2PK (preferred) or HTLC preimage (fallback)
    const useFrost = !!market.group_pubkey_yes && !!market.group_pubkey_no && dualKeyStore.has(id);

    let resolvedPreimage: string | undefined;
    let oracleSignature: string | undefined;

    if (useFrost) {
      // FROST P2PK mode: Oracle signs with the winning outcome's key.
      const signMessage = new TextEncoder().encode(`${id}:${outcome}`);
      const swapOutcome = outcome === "yes" ? "a" : "b";

      let sig: string | null = null;

      if (frostMode === "frost" && marketFrostConfig) {
        // Multi-Oracle threshold signing via peer coordination
        const verifiedBody = typeof body.verified_body === "string" ? body.verified_body : undefined;
        sig = await frostDualKeySignAsync(
          marketFrostConfig,
          swapOutcome,
          signMessage,
          verifiedBody ? {
            market_id: id,
            resolution_url: market.resolution_url,
            verified_body: verifiedBody,
          } : undefined,
        );
      } else {
        // Single-key signing (demo mode)
        sig = dualKeyStore.sign(id, swapOutcome, signMessage);
      }

      if (!sig) {
        return c.json({ error: "Resolution failed — signing failed (threshold not met or already signed)", mode: frostMode }, 503);
      }
      oracleSignature = sig;
      resolvedSignatures.set(id, sig);

      // Also resolve HTLC side for backward compatibility
      resolveMarket(id, outcome, dualPreimageStore);
    } else {
      // HTLC preimage mode (fallback)
      const result = resolveMarket(id, outcome, dualPreimageStore);
      if (!result) {
        return c.json({ error: "Resolution failed — preimage not found or already revealed" }, 500);
      }
      resolvedPreimage = result.preimage;
      resolvedPreimages.set(id, result.preimage);
    }

    // Update market status
    const newStatus: MarketStatus = outcome === "yes" ? "resolved_yes" : "resolved_no";
    market.status = newStatus;

    // Mark matched pairs as settled (but do NOT auto-redeem server-side).
    // Clients call POST /markets/:id/redeem to get their tokens + attestation.
    const settledPairs: Array<{
      pair_id: string;
      winner_pubkey: string;
      amount_sats: number;
    }> = [];

    for (const pair of matchedPairsStore.values()) {
      if (pair.market_id !== id || pair.status !== "locked") continue;
      pair.status = outcome === "yes" ? "settled_yes" : "settled_no";

      const winnerPubkey = outcome === "yes" ? pair.yes_pubkey : pair.no_pubkey;
      settledPairs.push({
        pair_id: pair.pair_id,
        winner_pubkey: winnerPubkey,
        amount_sats: pair.amount_sats,
      });
    }

    return c.json({
      market_id: id,
      outcome,
      // FROST P2PK mode returns oracle_signature; HTLC mode returns preimage
      ...(oracleSignature ? { oracle_signature: oracleSignature } : {}),
      ...(resolvedPreimage ? { preimage: resolvedPreimage } : {}),
      mode: useFrost ? "frost_p2pk" : "htlc",
      status: newStatus,
      yes_pool_sats: market.yes_pool_sats,
      no_pool_sats: market.no_pool_sats,
      settled_pairs: settledPairs,
    });
  });

  // -----------------------------------------------------------------------
  // POST /markets/:id/redeem — client-side redemption of winning HTLC tokens
  // -----------------------------------------------------------------------

  mkt.post("/:id/redeem", rateLimit, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Market id is required" }, 400);

    const market = markets.get(id);
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

    const preimage = resolvedPreimages.get(id);
    const oracleSignature = resolvedSignatures.get(id);

    if (!preimage && !oracleSignature) {
      return c.json({ error: "Resolution attestation not found — market may not be fully resolved" }, 500);
    }

    const outcome = market.status === "resolved_yes" ? "yes" : "no";

    // Find all matched pairs where this pubkey is the winner
    const winningPairs: Array<{
      pair_id: string;
      token: string;
      amount_sats: number;
      /** HTLC mode: preimage for redemption. */
      preimage?: string;
      /** FROST P2PK mode: Oracle's Schnorr signature for redemption. */
      oracle_signature?: string;
      /** Which group pubkey the signature corresponds to. */
      oracle_pubkey?: string;
    }> = [];

    for (const pair of matchedPairsStore.values()) {
      if (pair.market_id !== id) continue;

      const winnerPubkey = outcome === "yes" ? pair.yes_pubkey : pair.no_pubkey;
      if (winnerPubkey !== pubkey) continue;

      // The winner's redeemable token:
      // YES wins -> winner gets token_no_to_yes (locked to group_pubkey_a / hash_a)
      // NO wins  -> winner gets token_yes_to_no (locked to group_pubkey_b / hash_b)
      const redeemableToken = outcome === "yes" ? pair.token_no_to_yes : pair.token_yes_to_no;

      // For FROST P2PK: include the oracle pubkey so client knows which key signed
      const oraclePubkey = outcome === "yes" ? market.group_pubkey_yes : market.group_pubkey_no;

      winningPairs.push({
        pair_id: pair.pair_id,
        token: redeemableToken,
        amount_sats: pair.amount_sats,
        ...(preimage ? { preimage } : {}),
        ...(oracleSignature ? { oracle_signature: oracleSignature, oracle_pubkey: oraclePubkey } : {}),
      });
    }

    return c.json({ pairs: winningPairs });
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

  // --- FROST signer endpoints for market resolution (peer-to-peer signing) ---
  // signing-coordinator.ts calls /frost/signer/round1,2 on peer nodes.

  if (frostMode === "frost" && marketFrostConfig) {
    const pendingMarketNonces = new Map<string, { nonces: string; outcomeKey: "a" | "b" }>();

    app.post("/frost/signer/round1", writeAuth, async (c) => {
      const reqBody = await c.req.json<{
        message: string;
        query?: { id: string; resolution_url?: string };
        result?: { verified_body: string };
      }>().catch(() => null);
      if (!reqBody?.message || !marketFrostConfig) {
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
        const mkt = markets.get(marketId);
        if (mkt?.resolution_condition) {
          const condMet = evaluateCondition(mkt.resolution_condition, reqBody.result.verified_body);
          if ((condMet ? "yes" : "no") !== sigOutcome) {
            return c.json({ error: "Condition evaluation disagrees" }, 403);
          }
        }
      }

      const outcomeKey = sigOutcome === "yes" ? "a" as const : "b" as const;
      const keyPkg = outcomeKey === "a" ? marketFrostConfig.key_package : marketFrostConfig.key_package_no;
      const { signRound1 } = await import("./frost/frost-cli.ts");
      const r1 = await signRound1(JSON.stringify(keyPkg));
      if (!r1.ok) return c.json({ error: r1.error }, 500);

      const nonceId = crypto.randomUUID();
      pendingMarketNonces.set(nonceId, { nonces: JSON.stringify(r1.data!.nonces), outcomeKey });
      return c.json({ commitments: r1.data!.commitments, nonce_id: nonceId });
    });

    app.post("/frost/signer/round2", writeAuth, async (c) => {
      const reqBody = await c.req.json<{ commitments: string; message: string; nonce_id: string }>().catch(() => null);
      if (!reqBody?.commitments || !reqBody?.message || !reqBody?.nonce_id || !marketFrostConfig) {
        return c.json({ error: "Missing fields" }, 400);
      }
      const stored = pendingMarketNonces.get(reqBody.nonce_id);
      if (!stored) return c.json({ error: "Unknown nonce_id" }, 409);
      pendingMarketNonces.delete(reqBody.nonce_id);

      const keyPkg = stored.outcomeKey === "a" ? marketFrostConfig.key_package : marketFrostConfig.key_package_no;
      const { signRound2 } = await import("./frost/frost-cli.ts");
      const r2 = await signRound2(JSON.stringify(keyPkg), stored.nonces, reqBody.commitments, reqBody.message);
      if (!r2.ok) return c.json({ error: r2.error }, 500);
      return c.json({ signature_share: r2.data!.signature_share });
    });

    console.log("[market] FROST signer endpoints registered (/frost/signer/round1,2)");
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Clear all in-memory stores. Visible for testing. */
export function _clearMarketStoresForTest(): void {
  markets.clear();
  matchedPairsStore.clear();
  orderProofs.clear();
  userProofs.clear();
  resolvedPreimages.clear();
  resolvedSignatures.clear();
}
