/**
 * E2E: two-party binary bet full lifecycle on regtest Cashu.
 *
 * Walks the entire user-visible flow with real Cashu proofs:
 *   1. Mint sats for alice (YES) and bob (NO) via regtest Lightning.
 *   2. Create a market through the public Hono app.
 *   3. Each bettor places a bet -> server returns match info.
 *   4. Each bettor builds a P2PK-locked exchange token via the same
 *      `createLockedToken` helper the browser uses, and submits via
 *      /submit-token. Server pairs the two tokens.
 *   5. Resolve the market (YES) via the manual /resolve endpoint.
 *   6. Winner calls /sign-proofs and receives oracle signatures for
 *      each proof secret in the redeemable token.
 *
 * The test asserts the structural invariants (token decodes as cashuB,
 * signatures map onto the right proof secrets, server returns
 * `status: locked`, etc.). Actual mint redemption requires real
 * Lightning channels and is exercised in PR-G's manual sweep.
 *
 * Skipped automatically when the regtest mint isn't reachable.
 *
 * Run:
 *   docker compose up -d
 *   ./scripts/init-regtest.sh && docker compose restart cashu-mint
 *   CASHU_MINT_URL=http://localhost:3338 \
 *     deno test e2e/two-party-binary-bet-lifecycle.test.ts --allow-all
 */

import { afterAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { getDecodedToken, type Proof } from "@cashu/cashu-ts";
import {
  registerMarketRoutes,
  createMarketState,
  type MarketRouteContext,
  type MarketState,
} from "../example/two-party-binary-bet/src/server-routes.ts";
import { openKannagiStore, type KannagiStore } from "../example/two-party-binary-bet/src/kannagi-store.ts";
import { createLockedToken } from "../example/two-party-binary-bet/src/exchange-protocol.ts";
import {
  checkInfraReady,
  createWallet,
  generateKeypair,
  throttledMintProofs,
} from "./helpers/regtest.ts";
import process from "node:process";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const INFRA_READY = await checkInfraReady(MINT_URL);

const passthrough: MiddlewareHandler = async (_c, next) => { await next(); };

const BASE = "http://localhost";

interface MatchInfo {
  pair_id: string;
  amount_sats: number;
  counterparty_pubkey: string;
  group_pubkey_yes: string;
  group_pubkey_no: string;
  locktime_exchange: number;
  locktime_market: number;
}

interface BetResponse {
  order_id: string;
  matches: MatchInfo[];
  market: { yes_pool_sats: number; no_pool_sats: number };
}

function buildMarketApp(state: MarketState) {
  // deno-lint-ignore no-explicit-any
  const app = new Hono<any>();
  const ctx: MarketRouteContext = { writeAuth: passthrough, rateLimit: passthrough };
  registerMarketRoutes(app, ctx, state);
  return app;
}

async function postJson(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectJson<T>(res: Response, status: number): Promise<T> {
  expect(res.status).toBe(status);
  return res.json() as Promise<T>;
}

const suite = INFRA_READY ? describe : describe.ignore;

// Run the lifecycle against the SQLite-backed Kannagi store (the production
// code path). The store is :memory:, so the test exercises the same persist
// + hydrate code without any filesystem state leaking between tests.
let kannagiStore: KannagiStore | undefined;

suite("e2e: two-party binary bet lifecycle (regtest Cashu)", () => {
  afterAll(async () => {
    if (kannagiStore) await kannagiStore.close();
  });

  test("alice (YES) + bob (NO) bet → match → P2PK lock → YES resolve → alice signs proofs", async () => {
    // === Phase 1: Setup ===
    // Real secp256k1 pubkeys — cashu-ts' P2PKBuilder validates the key format
    // before locking, so opaque test strings won't pass.
    const alice = generateKeypair();
    const bob = generateKeypair();
    const ALICE_PK = alice.publicKey;
    const BOB_PK = bob.publicKey;

    // Each bettor uses an independent wallet instance so cashu-ts's
    // per-wallet keyset cache stays consistent with the proofs it minted.
    // Mint headroom: a regtest mint can charge a small swap fee, and
    // wallet.ops.send(BET_SATS, proofs) needs `proofs ≥ BET_SATS + fee`. The
    // matchmaker also verifies the locked amount is ≥ BET_SATS via
    // verifyReceivedToken, so we mint power-of-two slack on top of the bet.
    const BET_SATS = 200;
    const MINT_SATS = 256;

    const aliceWallet = await createWallet(MINT_URL);
    const bobWallet = await createWallet(MINT_URL);
    const serverWallet = await createWallet(MINT_URL);
    const aliceProofs: Proof[] = await throttledMintProofs(aliceWallet, MINT_SATS);
    const bobProofs: Proof[] = await throttledMintProofs(bobWallet, MINT_SATS);

    expect(aliceProofs.reduce((s, p) => s + p.amount, 0)).toBe(MINT_SATS);
    expect(bobProofs.reduce((s, p) => s + p.amount, 0)).toBe(MINT_SATS);

    // Wire the in-process market server with a wallet so /submit-token can
    // decode real cashuB tokens. The market server only needs decode/verify,
    // not signing power, so an independent wallet handle is fine.
    //
    // The OrderBook is the SQLite-backed implementation — the same code
    // path production uses — so this test exercises the full SQL stack
    // (insert, partial-index scan, transactional matching) on top of the
    // Cashu/HTLC machinery.
    kannagiStore = openKannagiStore({ path: ":memory:" });
    const hydrated = await kannagiStore.hydrate();
    const state = createMarketState({
      orderBook: kannagiStore.orderBook,
      initial: hydrated,
      persist: kannagiStore.persist,
    });
    state.getCashuWallet = async () => serverWallet;
    const app = buildMarketApp(state);

    // === Phase 2: Create the market ===
    const deadline = Math.floor(Date.now() / 1000) + 86400;
    const marketRes = await postJson(app, "/markets", {
      title: "Test market: yes wins",
      description: "Lifecycle e2e",
      category: "crypto",
      resolution_url: "https://api.example.com/price",
      resolution_deadline: deadline,
      resolution_condition: {
        type: "price_above",
        target_url: "https://api.example.com/price",
        threshold: 0,
        description: "always YES",
      },
    });
    const market = await expectJson<{ id: string; group_pubkey_yes: string; group_pubkey_no: string }>(marketRes, 201);
    expect(market.id).toBeTruthy();
    expect(market.group_pubkey_yes).toBeTruthy();
    expect(market.group_pubkey_no).toBeTruthy();

    // === Phase 3: Place bets — alice on YES, bob on NO ===
    const aliceBet = await expectJson<BetResponse>(
      await postJson(app, `/markets/${market.id}/bet`, {
        side: "yes",
        amount_sats: BET_SATS,
        bettor_pubkey: ALICE_PK,
      }),
      201,
    );
    expect(aliceBet.matches.length).toBe(0); // No counterparty yet

    const bobBet = await expectJson<BetResponse>(
      await postJson(app, `/markets/${market.id}/bet`, {
        side: "no",
        amount_sats: BET_SATS,
        bettor_pubkey: BOB_PK,
      }),
      201,
    );
    expect(bobBet.matches.length).toBe(1);

    const match = bobBet.matches[0]!;
    expect(match.amount_sats).toBe(BET_SATS);
    expect(match.counterparty_pubkey).toBe(ALICE_PK); // bob's counterparty is alice
    expect(match.group_pubkey_yes).toBe(market.group_pubkey_yes);
    expect(match.group_pubkey_no).toBe(market.group_pubkey_no);

    // === Phase 4: Both bettors create P2PK tokens and submit ===
    const aliceToken = await createLockedToken(aliceWallet, aliceProofs, {
      mintUrl: MINT_URL,
      marketGroupPubkeyYes: match.group_pubkey_yes,
      marketGroupPubkeyNo: match.group_pubkey_no,
      myPubkey: ALICE_PK,
      mySide: "yes",
      counterpartyPubkey: BOB_PK,
      amountSats: BET_SATS,
      exchangeLocktime: match.locktime_exchange,
      marketLocktime: match.locktime_market,
    });
    expect(aliceToken.token.startsWith("cashuB")).toBe(true);

    const bobToken = await createLockedToken(bobWallet, bobProofs, {
      mintUrl: MINT_URL,
      marketGroupPubkeyYes: match.group_pubkey_yes,
      marketGroupPubkeyNo: match.group_pubkey_no,
      myPubkey: BOB_PK,
      mySide: "no",
      counterpartyPubkey: ALICE_PK,
      amountSats: BET_SATS,
      exchangeLocktime: match.locktime_exchange,
      marketLocktime: match.locktime_market,
    });
    expect(bobToken.token.startsWith("cashuB")).toBe(true);

    // Alice submits first — server should accept and return pending.
    const aliceSubmit = await expectJson<{ status: string }>(
      await postJson(app, `/markets/${market.id}/submit-token`, {
        pair_id: match.pair_id,
        cashu_token: aliceToken.token,
        bettor_pubkey: ALICE_PK,
      }),
      200,
    );
    expect(aliceSubmit.status).toBe("pending");

    // Bob submits — both sides present, server should mark locked and hand
    // each side the counterparty's redeemable token.
    const bobSubmit = await expectJson<{ status: string; redeemable_token: string }>(
      await postJson(app, `/markets/${market.id}/submit-token`, {
        pair_id: match.pair_id,
        cashu_token: bobToken.token,
        bettor_pubkey: BOB_PK,
      }),
      200,
    );
    expect(bobSubmit.status).toBe("locked");
    expect(bobSubmit.redeemable_token).toBe(aliceToken.token); // bob holds alice's token

    // === Phase 5: Resolve the market to YES ===
    // The manual /resolve endpoint accepts an outcome directly so the test
    // doesn't need a TLSNotary verifier binary to pass.
    const resolveRes = await postJson(app, `/markets/${market.id}/resolve`, {
      outcome: "yes",
    });
    expect(resolveRes.status).toBe(200);

    // === Phase 6: Winner (alice — held bob's NO-locked token) signs proofs ===
    // Alice received bob's token (bobToken). She submits the secrets so the
    // Oracle co-signs each NUT-11 P2PK lock condition.
    //
    // cashu-ts encodes proofs with short v2 keyset IDs in cashuB tokens. To
    // decode, getDecodedToken needs the wallet's known keyset IDs to expand
    // short → long; without them it throws "Couldn't map short keyset ID …".
    const knownKeysetIds = bobWallet.keyChain.getAllKeysetIds();
    const decodedBob = getDecodedToken(bobToken.token, knownKeysetIds);
    expect(decodedBob.proofs.length).toBeGreaterThan(0);
    const aliceProofSecrets = decodedBob.proofs.map((p) => p.secret);

    const signRes = await postJson(app, `/markets/${market.id}/sign-proofs`, {
      pubkey: ALICE_PK,
      proof_secrets: aliceProofSecrets,
    });
    const signed = await expectJson<{
      outcome: string;
      oracle_signatures: Record<string, string>;
      signed_count: number;
      total_requested: number;
    }>(signRes, 200);

    expect(signed.outcome).toBe("yes");
    expect(signed.signed_count).toBe(aliceProofSecrets.length);
    expect(signed.total_requested).toBe(aliceProofSecrets.length);
    // Each requested secret must have a signature back.
    for (const secret of aliceProofSecrets) {
      expect(typeof signed.oracle_signatures[secret]).toBe("string");
      expect(signed.oracle_signatures[secret]!.length).toBeGreaterThan(0);
    }

    // === Phase 7: Loser (bob — held alice's YES-locked token) is rejected ===
    const decodedAlice = getDecodedToken(aliceToken.token, aliceWallet.keyChain.getAllKeysetIds());
    const bobSignTry = await postJson(app, `/markets/${market.id}/sign-proofs`, {
      pubkey: BOB_PK,
      proof_secrets: decodedAlice.proofs.map((p) => p.secret),
    });
    expect(bobSignTry.status).toBe(403);
  });
});
