/**
 * Prediction Market API Routes -- Hono HTTP server for market operations.
 *
 * Supports two resolution modes:
 * - Single-key (demo): Local Schnorr signing via DualKeyStore
 * - FROST threshold: Distributed t-of-n signing via FROST Oracle cluster
 *
 * The mode is selected at startup based on the FROST_MARKET_CONFIG_PATH env var.
 * When FROST config is present and frost-signer is available, the server uses
 * threshold signing. Otherwise, it falls back to single-key demo mode.
 */

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { createOrderBook, type OrderBook } from "./order-book.ts";
import { createDualPreimageStore, type DualPreimageStore } from "../../../src/infrastructure/conditional-swap/dual-preimage-store.ts";
import type { DualKeyStore } from "../../../src/infrastructure/conditional-swap/frost-conditional-swap.ts";
import {
  createAdaptiveDualKeyStore,
  frostDualKeySignAsync,
} from "../../../src/infrastructure/conditional-swap/frost-dual-key-store.ts";
import type { MarketFrostNodeConfig } from "../../../src/infrastructure/frost/market-frost-config.ts";
import {
  evaluateCondition,
  calculatePayouts,
  calculateOracleFee,
} from "./market-oracle.ts";
import { resolveMarket as resolveMarketDual } from "./resolution.ts";
import type {
  PredictionMarket,
  Bet,
  MarketResolution,
} from "./market-types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketApiConfig {
  /** API key for protecting endpoints (optional). */
  apiKey?: string;
  /** Pre-loaded market FROST config (from DKG bootstrap). */
  marketFrostConfig?: MarketFrostNodeConfig;
  /** Oracle fee in parts per million (default: 5000 = 0.5%). */
  oracleFeePpm?: number;
}

export interface MarketApiState {
  /** Active markets. */
  markets: Map<string, PredictionMarket>;
  /** All bets placed. */
  bets: Map<string, Bet[]>;
  /** Order book for matching. */
  orderBook: OrderBook;
  /** Dual preimage store (HTLC fallback). */
  dualPreimageStore: DualPreimageStore;
  /** Dual key store (single-key or FROST). */
  dualKeyStore: DualKeyStore;
  /** Resolution mode. */
  mode: "frost" | "single-key";
  /** FROST config (if available). */
  frostConfig?: MarketFrostNodeConfig;
}

// ---------------------------------------------------------------------------
// Route builder
// ---------------------------------------------------------------------------

export function buildMarketApiRoutes(config: MarketApiConfig = {}): { app: Hono; state: MarketApiState } {
  const oracleFeePpm = config.oracleFeePpm ?? 5_000;

  // Select signing mode
  const { store: dualKeyStore, mode, config: frostConfig } = createAdaptiveDualKeyStore(
    config.marketFrostConfig,
  );

  console.log(`[market-api] Resolution mode: ${mode}`);
  if (mode === "frost" && frostConfig) {
    console.log(`[market-api] FROST ${frostConfig.threshold}-of-${frostConfig.total_signers}`);
    console.log(`[market-api] YES group pubkey: ${frostConfig.group_pubkey.slice(0, 16)}...`);
    console.log(`[market-api] NO  group pubkey: ${frostConfig.group_pubkey_no.slice(0, 16)}...`);
  } else {
    console.log("[market-api] Using single-key Schnorr signing (demo mode)");
  }

  const state: MarketApiState = {
    markets: new Map(),
    bets: new Map(),
    orderBook: createOrderBook(),
    dualPreimageStore: createDualPreimageStore(),
    dualKeyStore,
    mode,
    frostConfig,
  };

  const app = new Hono();

  // Auth middleware
  const authMiddleware: MiddlewareHandler = async (c, next) => {
    if (!config.apiKey) return next();
    const key = c.req.header("x-api-key") ?? c.req.header("authorization")?.slice(7);
    if (!key || key !== config.apiKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };

  // --- Health / Info ---

  app.get("/health", (c) => c.json({ ok: true, mode: state.mode }));

  app.get("/info", (c) => c.json({
    mode: state.mode,
    frost: state.frostConfig ? {
      threshold: state.frostConfig.threshold,
      total_signers: state.frostConfig.total_signers,
      group_pubkey_yes: state.frostConfig.group_pubkey,
      group_pubkey_no: state.frostConfig.group_pubkey_no,
    } : null,
    oracle_fee_ppm: oracleFeePpm,
  }));

  // --- Market CRUD ---

  app.post("/markets", authMiddleware, async (c) => {
    const body = await c.req.json<Partial<PredictionMarket>>().catch(() => null);
    if (!body?.id || !body?.title) {
      return c.json({ error: "Missing required fields (id, title)" }, 400);
    }

    // Generate keys for this market
    const preimages = state.dualPreimageStore.create(body.id);
    const keys = state.dualKeyStore.create(body.id);

    const market: PredictionMarket = {
      id: body.id,
      title: body.title,
      description: body.description ?? "",
      category: body.category ?? "custom",
      creator_pubkey: body.creator_pubkey ?? "",
      resolution_url: body.resolution_url ?? "",
      resolution_condition: body.resolution_condition ?? {
        type: "contains_text",
        target_url: "",
        expected_text: "",
        description: "",
      },
      resolution_deadline: body.resolution_deadline ?? Math.floor(Date.now() / 1000) + 86400,
      yes_pool_sats: 0,
      no_pool_sats: 0,
      min_bet_sats: body.min_bet_sats ?? 1,
      max_bet_sats: body.max_bet_sats ?? 1_000_000,
      fee_ppm: body.fee_ppm ?? 10_000,
      oracle_pubkey: body.oracle_pubkey ?? "",
      htlc_hash_yes: preimages.hash_a,
      htlc_hash_no: preimages.hash_b,
      group_pubkey_yes: keys.pubkey_a,
      group_pubkey_no: keys.pubkey_b,
      nostr_event_id: body.nostr_event_id ?? "",
      status: "open",
    };

    state.markets.set(market.id, market);
    state.bets.set(market.id, []);

    return c.json({
      market_id: market.id,
      group_pubkey_yes: keys.pubkey_a,
      group_pubkey_no: keys.pubkey_b,
      htlc_hash_yes: preimages.hash_a,
      htlc_hash_no: preimages.hash_b,
      mode: state.mode,
    }, 201);
  });

  app.get("/markets/:id", (c) => {
    const market = state.markets.get(c.req.param("id"));
    if (!market) return c.json({ error: "Market not found" }, 404);
    return c.json(market);
  });

  // --- Resolution ---

  /**
   * POST /markets/:id/resolve
   *
   * Resolves a market based on verified data.
   *
   * In single-key mode: Signs locally with Schnorr.
   * In FROST mode:
   *   1. Evaluates the condition from verified_body
   *   2. Determines the outcome (YES/NO)
   *   3. Coordinates FROST signing with peer Oracle nodes
   *   4. Each peer independently evaluates the condition before signing
   *   5. If t-of-n agree -> group signature -> market resolved
   *   6. If below threshold -> signing fails -> market stays open
   */
  app.post("/markets/:id/resolve", authMiddleware, async (c) => {
    const marketId = c.req.param("id");
    const market = state.markets.get(marketId);
    if (!market) return c.json({ error: "Market not found" }, 404);
    if (market.status !== "open" && market.status !== "closed") {
      return c.json({ error: `Market is ${market.status}, cannot resolve` }, 409);
    }

    const body = await c.req.json<{
      verified_body: string;
      server_name?: string;
      tlsn_proof?: string;
      timestamp?: number;
    }>().catch(() => null);

    if (!body?.verified_body) {
      return c.json({ error: "Missing verified_body" }, 400);
    }

    // Evaluate the condition
    const conditionMet = evaluateCondition(market.resolution_condition, body.verified_body);
    const outcome: "yes" | "no" = conditionMet ? "yes" : "no";
    const swapOutcome: "a" | "b" = outcome === "yes" ? "a" : "b";

    let oracleSignature: string | null = null;
    let preimage: string | undefined;

    if (state.mode === "frost" && state.frostConfig) {
      // FROST threshold signing
      market.status = "resolving";
      const message = new TextEncoder().encode(`${marketId}:${outcome}`);

      oracleSignature = await frostDualKeySignAsync(
        state.frostConfig,
        swapOutcome,
        message,
        {
          market_id: marketId,
          resolution_url: market.resolution_url,
          verified_body: body.verified_body,
        },
      );

      if (!oracleSignature) {
        market.status = "open"; // Revert -- signing failed (below threshold)
        return c.json({
          error: "FROST signing failed -- threshold not met",
          outcome,
          threshold: state.frostConfig.threshold,
          total_signers: state.frostConfig.total_signers,
        }, 503);
      }
    } else {
      // Single-key signing
      const message = new TextEncoder().encode(`${marketId}:${outcome}`);
      oracleSignature = state.dualKeyStore.sign(marketId, swapOutcome, message);
    }

    // Also handle HTLC preimage (backward compat)
    const htlcResult = resolveMarketDual(marketId, outcome, state.dualPreimageStore);
    if (htlcResult) {
      preimage = htlcResult.preimage;
    }

    // Update market status
    market.status = outcome === "yes" ? "resolved_yes" : "resolved_no";

    const resolution: MarketResolution = {
      market_id: marketId,
      outcome,
      tlsn_proof: body.tlsn_proof ?? "",
      verified_data: {
        server_name: body.server_name ?? new URL(market.resolution_url).hostname,
        revealed_body: body.verified_body,
        timestamp: body.timestamp ?? Math.floor(Date.now() / 1000),
      },
      preimage,
      oracle_signature: oracleSignature ?? undefined,
    };

    // Calculate payouts
    const allBets = (state.bets.get(marketId) ?? []).map(b => ({
      side: b.side,
      amount_sats: b.amount_sats,
      bettor_pubkey: b.bettor_pubkey,
    }));
    const payouts = calculatePayouts(market, outcome, allBets, oracleFeePpm);

    return c.json({
      resolution,
      mode: state.mode,
      payouts,
    });
  });

  // --- FROST Market Signer endpoints (called by peer Oracle nodes) ---

  /**
   * POST /frost/market/signer/round1
   *
   * Peer Oracle nodes call this during FROST signing coordination.
   * This node independently evaluates the market condition before
   * producing nonce commitments. If the condition evaluation disagrees
   * with the requested outcome, this node refuses to sign.
   */
  app.post("/frost/market/signer/round1", authMiddleware, async (c) => {
    const body = await c.req.json<{
      message: string;
      market_id: string;
      outcome: string;
      condition_data: {
        resolution_condition: PredictionMarket["resolution_condition"];
        verified_body: string;
      };
    }>().catch(() => null);

    if (!body?.message || !body?.market_id || !body?.outcome || !body?.condition_data) {
      return c.json({ error: "Missing message, market_id, outcome, or condition_data" }, 400);
    }
    if (!state.frostConfig) {
      return c.json({ error: "FROST not configured on this node" }, 503);
    }

    // Independent condition evaluation -- the security guarantee
    const conditionMet = evaluateCondition(
      body.condition_data.resolution_condition,
      body.condition_data.verified_body,
    );
    const localOutcome = conditionMet ? "yes" : "no";

    if (localOutcome !== body.outcome) {
      return c.json({
        error: "Condition evaluation disagrees with requested outcome",
        local_outcome: localOutcome,
        requested_outcome: body.outcome,
      }, 403);
    }

    // Select the correct key package based on outcome
    const outcomeKey = body.outcome === "yes" ? "a" : "b";
    const keyPackage = outcomeKey === "a"
      ? state.frostConfig.key_package
      : state.frostConfig.key_package_no;

    const { signRound1 } = await import("../../../src/infrastructure/frost/frost-cli.ts");
    const keyPackageJson = JSON.stringify(keyPackage);
    const result = await signRound1(keyPackageJson);
    if (!result.ok) {
      return c.json({ error: result.error }, 500);
    }

    // Store nonces with a random session ID
    const nonceId = crypto.randomUUID();
    pendingMarketNonces.set(nonceId, {
      nonces: JSON.stringify(result.data!.nonces),
      outcomeKey,
    });

    return c.json({ commitments: result.data!.commitments, nonce_id: nonceId });
  });

  /**
   * POST /frost/market/signer/round2
   *
   * Produce signature share using stored nonces from round1.
   */
  app.post("/frost/market/signer/round2", authMiddleware, async (c) => {
    const body = await c.req.json<{
      commitments: string;
      message: string;
      nonce_id: string;
    }>().catch(() => null);

    if (!body?.commitments || !body?.message || !body?.nonce_id) {
      return c.json({ error: "Missing commitments, message, or nonce_id" }, 400);
    }
    if (!state.frostConfig) {
      return c.json({ error: "FROST not configured on this node" }, 503);
    }

    const nonceEntry = pendingMarketNonces.get(body.nonce_id);
    if (!nonceEntry) {
      return c.json({ error: "Unknown or expired nonce_id" }, 409);
    }
    pendingMarketNonces.delete(body.nonce_id); // Consume immediately -- single use

    // Select key package based on the outcome determined in round1
    const keyPackage = nonceEntry.outcomeKey === "a"
      ? state.frostConfig.key_package
      : state.frostConfig.key_package_no;

    const { signRound2 } = await import("../../../src/infrastructure/frost/frost-cli.ts");
    const keyPackageJson = JSON.stringify(keyPackage);
    const result = await signRound2(keyPackageJson, nonceEntry.nonces, body.commitments, body.message);

    if (!result.ok) {
      return c.json({ error: result.error }, 500);
    }
    return c.json({ signature_share: result.data!.signature_share });
  });

  // --- Compatibility: signing-coordinator.ts calls /frost/signer/round1,2 ---
  // Map these to the market-specific handlers that include condition evaluation.

  app.post("/frost/signer/round1", authMiddleware, async (c) => {
    const body = await c.req.json<{
      message: string;
      query?: { id: string; type: string; resolution_url: string };
      result?: { verified_body: string };
    }>().catch(() => null);

    if (!body?.message || !state.frostConfig) {
      return c.json({ error: "Missing message or FROST not configured" }, 400);
    }

    // Extract market ID and outcome from the signing message: "{marketId}:{outcome}"
    const msgBytes = new Uint8Array(body.message.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
    const msgText = new TextDecoder().decode(msgBytes);
    const [marketId, outcome] = msgText.split(":");

    if (!marketId || !outcome || (outcome !== "yes" && outcome !== "no")) {
      return c.json({ error: `Cannot parse market message: ${msgText}` }, 400);
    }

    // Independent condition evaluation if verified_body is provided
    if (body.result?.verified_body) {
      const market = state.markets.get(marketId);
      if (market) {
        const conditionMet = evaluateCondition(market.resolution_condition, body.result.verified_body);
        const localOutcome = conditionMet ? "yes" : "no";
        if (localOutcome !== outcome) {
          return c.json({ error: "Condition evaluation disagrees", local_outcome: localOutcome }, 403);
        }
      }
    }

    const outcomeKey = outcome === "yes" ? "a" : "b";
    const keyPackage = outcomeKey === "a" ? state.frostConfig.key_package : state.frostConfig.key_package_no;
    const { signRound1 } = await import("../../../src/infrastructure/frost/frost-cli.ts");
    const result = await signRound1(JSON.stringify(keyPackage));
    if (!result.ok) return c.json({ error: result.error }, 500);

    const nonceId = crypto.randomUUID();
    pendingMarketNonces.set(nonceId, { nonces: JSON.stringify(result.data!.nonces), outcomeKey });
    return c.json({ commitments: result.data!.commitments, nonce_id: nonceId });
  });

  app.post("/frost/signer/round2", authMiddleware, async (c) => {
    const body = await c.req.json<{ commitments: string; message: string; nonce_id: string }>().catch(() => null);
    if (!body?.commitments || !body?.message || !body?.nonce_id || !state.frostConfig) {
      return c.json({ error: "Missing fields or FROST not configured" }, 400);
    }
    const stored = pendingMarketNonces.get(body.nonce_id);
    if (!stored) return c.json({ error: "Unknown nonce_id" }, 409);
    pendingMarketNonces.delete(body.nonce_id);

    const keyPackage = stored.outcomeKey === "a" ? state.frostConfig.key_package : state.frostConfig.key_package_no;
    const { signRound2 } = await import("../../../src/infrastructure/frost/frost-cli.ts");
    const result = await signRound2(JSON.stringify(keyPackage), stored.nonces, body.commitments, body.message);
    if (!result.ok) return c.json({ error: result.error }, 500);
    return c.json({ signature_share: result.data!.signature_share });
  });

  return { app, state };
}

// Pending nonces for market FROST signing sessions
const pendingMarketNonces = new Map<string, { nonces: string; outcomeKey: "a" | "b" }>();
