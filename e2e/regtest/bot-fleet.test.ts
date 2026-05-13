/**
 * E2E: market-maker bot fleet against a regtest-backed market server.
 *
 * Spins up an in-process Hono app (no docker for the server itself; we
 * still use the real regtest Cashu mint via Lightning), seeds a single
 * Polymarket-style market, and runs two bots in opposite directions to
 * verify the full bet → match → P2PK-locked submit-token path completes
 * with real cashuB tokens. Skipped automatically when the regtest mint
 * isn't reachable.
 *
 * Run:
 *   docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint
 *   CASHU_MINT_URL=http://localhost:3338 deno test e2e/bot-fleet.test.ts --allow-all
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  createMarketState,
  type MarketRouteContext,
  type MarketState,
  registerMarketRoutes,
} from "../../example/two-party-binary-bet/src/server-routes.ts";
import { checkInfraReady, createWallet } from "../helpers/regtest.ts";
import { MarketMakerBot } from "../../scripts/bot-fleet/bot.ts";
import { POLYMARKET_SEED_MARKETS } from "../../scripts/bot-fleet/markets.ts";
import {
  fundFleet,
  runOneRound,
  seedMarkets,
} from "../../scripts/bot-fleet/fleet.ts";
import process from "node:process";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const INFRA_READY = await checkInfraReady(MINT_URL);

const passthrough: MiddlewareHandler = async (_c, next) => {
  await next();
};

function buildMarketApp(state: MarketState) {
  // deno-lint-ignore no-explicit-any
  const app = new Hono<any>();
  const ctx: MarketRouteContext = {
    writeAuth: passthrough,
    rateLimit: passthrough,
  };
  registerMarketRoutes(app, ctx, state);
  return app;
}

const suite = INFRA_READY ? describe : describe.ignore;

suite("e2e: market-maker bot fleet (regtest Cashu)", () => {
  test("two bots match on a single market with real cashuB tokens", async () => {
    // === Setup ===
    const state = createMarketState();
    state.getCashuWallet = async () => createWallet(MINT_URL);
    const app = buildMarketApp(state);

    // The bots talk over real HTTP, but for the in-process test we wire
    // their fetch to the Hono app via a localhost server that proxies to it.
    const port = 3001 + Math.floor(Math.random() * 1000);
    const ac = new AbortController();
    const server = Deno.serve(
      { port, signal: ac.signal, onListen: () => {} },
      app.fetch,
    );

    try {
      // === Seed one market ===
      const seed = POLYMARKET_SEED_MARKETS[0]!; // BTC $200k
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      const createRes = await fetch(`http://localhost:${port}/markets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: seed.title,
          description: seed.description,
          category: seed.category,
          resolution_url: seed.resolution_url,
          resolution_deadline: deadline,
          resolution_condition: {
            ...seed.resolution_condition,
            target_url: seed.resolution_url,
            description: seed.title,
          },
          min_bet_sats: 100,
        }),
      });
      expect(createRes.status).toBe(201);
      const market = await createRes.json() as { id: string };
      expect(market.id).toBeTruthy();

      // === Fund two bots from the regtest faucet ===
      const FUND = 256;
      const BET = 200;
      const [yesBot, noBot] = await Promise.all([
        MarketMakerBot.fund({
          serverUrl: `http://localhost:${port}`,
          mintUrl: MINT_URL,
          initialFundingSats: FUND,
          label: "yes-bot",
        }),
        MarketMakerBot.fund({
          serverUrl: `http://localhost:${port}`,
          mintUrl: MINT_URL,
          initialFundingSats: FUND,
          label: "no-bot",
        }),
      ]);
      expect(yesBot.balanceSats()).toBe(FUND);
      expect(noBot.balanceSats()).toBe(FUND);

      // === Place bets ===
      const yesResult = await yesBot.placeBet(market.id, "yes", BET);
      expect(yesResult.matches.length).toBe(0); // No counterparty yet
      expect(yesResult.committedSats).toBe(0);

      const noResult = await noBot.placeBet(market.id, "no", BET);
      expect(noResult.matches.length).toBe(1);
      expect(noResult.matches[0].amount_sats).toBe(BET);
      expect(noResult.matches[0].counterparty_pubkey).toBe(
        yesBot.identity.pubkey,
      );
      expect(noResult.submittedCount).toBe(1); // no-bot submitted its side

      // YES-bot's order matched but no /bet response was sent to it. Bot
      // polls user_pairs and submits token for any pending pair.
      const yesSubmitted = await yesBot.submitPendingMatches(market.id, "yes");
      expect(yesSubmitted).toBe(1);

      // === Verify pair is locked ===
      const detail = await fetch(
        `http://localhost:${port}/markets/${market.id}?pubkey=${yesBot.identity.pubkey}`,
      )
        .then((r) => r.json()) as { user_pairs?: Array<{ status: string }> };
      expect(detail.user_pairs?.length).toBe(1);
      expect(detail.user_pairs?.[0]?.status).toBe("locked");
    } finally {
      ac.abort();
      await server.finished;
    }
  });

  test("fresh-DB fleet seeds 3 markets and forms locked pairs", async () => {
    // Validates the user's "市場形成" requirement: a clean state can be
    // populated end-to-end by the bot fleet with real Cashu tokens.
    const state = createMarketState();
    state.getCashuWallet = async () => createWallet(MINT_URL);
    const app = buildMarketApp(state);

    const port = 4001 + Math.floor(Math.random() * 1000);
    const ac = new AbortController();
    const server = Deno.serve(
      { port, signal: ac.signal, onListen: () => {} },
      app.fetch,
    );

    try {
      const SUBSET = POLYMARKET_SEED_MARKETS.slice(0, 3); // BTC $200k, ETH $5k, BTC ETF
      const seeded = await seedMarkets(`http://localhost:${port}`, SUBSET);
      expect(seeded.length).toBe(3);

      // 2 YES-leaning + 2 NO-leaning. Funding sized to cover ~3 bets/market.
      const profiles = await fundFleet({
        serverUrl: `http://localhost:${port}`,
        mintUrl: MINT_URL,
        yesLeaningBots: 2,
        noLeaningBots: 2,
        fundingSatsPerBot: 32_768, // generous, slack for change/fees
      });
      expect(profiles.length).toBe(4);

      const result = await runOneRound(profiles, seeded, {
        rngSeed: 42,
        betSizeFactor: 0.1, // scale down vs realistic so 32k covers 3 markets
      });

      // Sanity: every bot placed at least one bet across the 3 markets.
      expect(result.totalBets).toBeGreaterThanOrEqual(profiles.length);
      // At least one pair locked end-to-end (real cashuB submission both sides).
      expect(result.pairsLocked).toBeGreaterThanOrEqual(1);

      // Verify pool ratios reflect bets — at least one market has both sides.
      let marketsWithLockedPairs = 0;
      for (const m of seeded) {
        const detail = await fetch(`http://localhost:${port}/markets/${m.id}`)
          .then((r) => r.json()) as {
            yes_pool_sats: number;
            no_pool_sats: number;
            matched_pairs: number;
          };
        if (detail.matched_pairs > 0) marketsWithLockedPairs++;
        // Either side can be empty on a small fleet, but the *total* pool
        // must be nonzero on every market the fleet touched.
        expect(detail.yes_pool_sats + detail.no_pool_sats).toBeGreaterThan(0);
      }
      expect(marketsWithLockedPairs).toBeGreaterThanOrEqual(1);
    } finally {
      ac.abort();
      await server.finished;
    }
  });
});
