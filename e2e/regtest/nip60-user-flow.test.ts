/**
 * E2E: NIP-60-backed user participating in two-party binary bet.
 *
 * Demonstrates the user-facing path:
 *   1. Open a fresh NIP-60 wallet (real Nostr nsec, real relay).
 *   2. Fund via the regtest Lightning faucet → kind:7375 token event.
 *   3. Place a real bet, get matched, submit P2PK-locked token.
 *   4. Confirm the change proofs land back in the NIP-60 wallet, and the
 *      pair status went to `locked` on the market server.
 *   5. Open a *second* wallet handle from the same nsec — proofs are read
 *      back from the relay; no localStorage / in-process shortcut.
 *
 * No dummy state. Real Cashu mint, real Lightning faucet, real Nostr relay.
 *
 * Run:
 *   docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint
 *   CASHU_MINT_URL=http://localhost:3338 NOSTR_RELAY_URL=ws://localhost:7777 \
 *     deno test e2e/nip60-user-flow.test.ts --allow-all
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { generateSecretKey } from "nostr-tools/pure";
import {
  createMarketState,
  type MarketRouteContext,
  type MarketState,
  registerMarketRoutes,
} from "../../apps/two-party-binary-bet/src/server-routes.ts";
import {
  checkInfraReady,
  createWallet,
  isRelayReachable,
} from "../helpers/regtest.ts";
import { Nip60UserBot } from "../../scripts/bot-fleet/nip60-user.ts";
import { POLYMARKET_SEED_MARKETS } from "../../scripts/bot-fleet/markets.ts";
import { MarketMakerBot } from "../../scripts/bot-fleet/bot.ts";
import process from "node:process";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const RELAY_URL = process.env.NOSTR_RELAY_URL ?? "ws://localhost:7777";

const INFRA_READY = await checkInfraReady(MINT_URL) &&
  await isRelayReachable(RELAY_URL);

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

suite("e2e: NIP-60 user participates in two-party binary bet", () => {
  test("fund → bet → submit → wallet state persists across reopens", async () => {
    const state = createMarketState();
    state.getCashuWallet = async () => createWallet(MINT_URL);
    const app = buildMarketApp(state);

    const port = 5001 + Math.floor(Math.random() * 1000);
    const ac = new AbortController();
    const server = Deno.serve(
      { port, signal: ac.signal, onListen: () => {} },
      app.fetch,
    );
    const serverUrl = `http://localhost:${port}`;

    try {
      // Seed a market.
      const seed = POLYMARKET_SEED_MARKETS[0]!;
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      const createRes = await fetch(`${serverUrl}/markets`, {
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

      // === User: fresh NIP-60 wallet, fund from regtest ===
      const userSecret = generateSecretKey();
      const FUND = 256;
      const BET = 200;

      const user = await Nip60UserBot.open({
        serverUrl,
        mintUrl: MINT_URL,
        relayUrls: [RELAY_URL],
        nostrSecret: userSecret,
        label: "alice",
      });
      try {
        await user.fundFromRegtest(FUND);
        expect(await user.balance()).toBe(FUND);

        // === Counterparty bot ===
        const opponentBot = await MarketMakerBot.fund({
          serverUrl,
          mintUrl: MINT_URL,
          initialFundingSats: FUND,
          label: "opponent",
        });

        // User bets YES first (no match yet).
        const userResult = await user.placeBet(market.id, "yes", BET);
        expect(userResult.matches.length).toBe(0);

        // Bot bets NO → matches the user's order.
        const botResult = await opponentBot.placeBet(market.id, "no", BET);
        expect(botResult.matches.length).toBe(1);
        expect(botResult.matches[0].counterparty_pubkey).toBe(user.nostrPubkey);
        expect(botResult.submittedCount).toBe(1);

        // User polls for the pending pair and submits its token.
        const submitted = await user.submitPendingMatches(market.id, "yes");
        expect(submitted).toBe(1);

        // === Verify pair locked and user's NIP-60 wallet shrunk by BET ===
        const detail = await fetch(
          `${serverUrl}/markets/${market.id}?pubkey=${user.nostrPubkey}`,
        )
          .then((r) => r.json()) as { user_pairs?: Array<{ status: string }> };
        expect(detail.user_pairs?.length).toBe(1);
        expect(detail.user_pairs?.[0]?.status).toBe("locked");

        const afterBet = await user.balance();
        expect(afterBet).toBeLessThan(FUND);
        // Change is FUND - BET minus the mint's input fee. Nutshell on
        // regtest charges input_fee_ppk=100 (≈1 sat per 1–10 inputs in a
        // swap); for a single 256-sat input the fee is 1 sat. Allow a small
        // window — the exact fee depends on how many denominations the send
        // op has to consume.
        const expectedChange = FUND - BET;
        const maxFee = 5;
        expect(afterBet).toBeLessThanOrEqual(expectedChange);
        expect(afterBet).toBeGreaterThanOrEqual(expectedChange - maxFee);

        // === Reopen — new handle, same nsec, fresh pool ===
        const reopened = await Nip60UserBot.open({
          serverUrl,
          mintUrl: MINT_URL,
          relayUrls: [RELAY_URL],
          nostrSecret: userSecret,
          label: "alice-reopened",
        });
        try {
          // Wallet was loaded from relay events alone — must still see the change.
          const reopenedBalance = await reopened.balance();
          expect(reopenedBalance).toBe(afterBet);
        } finally {
          await reopened.close();
        }
      } finally {
        await user.close();
      }
    } finally {
      ac.abort();
      await server.finished;
    }
  });
});
