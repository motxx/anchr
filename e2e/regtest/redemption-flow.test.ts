/**
 * E2E: full resolution → redemption.
 *
 * Walks the entire path the UI's `redeemMarketWinnings()` would take:
 *   1. Alice (YES) and Bob (NO) place real bets that match.
 *   2. Both submit P2PK-locked tokens; pair reaches `locked`.
 *   3. Market resolves YES.
 *   4. Alice (winner) calls /sign-proofs with the proof secrets from the
 *      token she's holding (Bob's NO-locked token).
 *   5. Each proof's witness is pre-filled with the oracle signature; then
 *      signP2PKProofs adds Alice's signature → n_sigs=2 satisfied.
 *   6. The fully-signed proofs are encoded as a token and Alice calls
 *      `wallet.receive(token)` — the regtest Nutshell mint actually swaps
 *      them for plain proofs in Alice's wallet. Asserts Alice's balance
 *      grew by Bob's locked amount minus the mint's swap fee.
 *
 * The loser-cannot-redeem case is also exercised — the oracle's 403
 * response asserts the trust boundary ("only the winner gets the
 * secret").
 *
 * Run:
 *   docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint
 *   CASHU_MINT_URL=http://localhost:3338 deno test e2e/redemption-flow.test.ts --allow-all
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  getDecodedToken,
  getEncodedToken,
  type Proof,
  signP2PKProofs,
} from "@cashu/cashu-ts";
import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  createMarketState,
  type MarketRouteContext,
  type MarketState,
  registerMarketRoutes,
} from "../../apps/two-party-binary-bet/src/server-routes.ts";
import { createLockedToken } from "../../apps/two-party-binary-bet/src/exchange-protocol.ts";
import {
  checkInfraReady,
  createWallet,
  generateKeypair,
  throttledMintProofs,
} from "../helpers/regtest.ts";
import process from "node:process";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const INFRA_READY = await checkInfraReady(MINT_URL);

const passthrough: MiddlewareHandler = async (_c, next) => {
  await next();
};
const BASE = "http://localhost";

function buildApp(state: MarketState) {
  // deno-lint-ignore no-explicit-any
  const app = new Hono<any>();
  const ctx: MarketRouteContext = {
    writeAuth: passthrough,
    rateLimit: passthrough,
  };
  registerMarketRoutes(app, ctx, state);
  return app;
}

async function postJson(
  app: Hono,
  path: string,
  body: unknown,
): Promise<Response> {
  return app.request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const suite = INFRA_READY ? describe : describe.ignore;

suite("e2e: redemption flow (regtest Cashu)", () => {
  test("alice wins, swaps bob's locked token for plain proofs at the mint", async () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const ALICE_PK = alice.publicKey;
    const BOB_PK = bob.publicKey;

    const BET_SATS = 200;
    const MINT_SATS = 256;

    const aliceWallet = await createWallet(MINT_URL);
    const bobWallet = await createWallet(MINT_URL);
    const serverWallet = await createWallet(MINT_URL);
    const aliceProofs: Proof[] = await throttledMintProofs(
      aliceWallet,
      MINT_SATS,
    );
    const bobProofs: Proof[] = await throttledMintProofs(bobWallet, MINT_SATS);

    const state = createMarketState();
    state.getCashuWallet = async () => serverWallet;
    const app = buildApp(state);

    // Create market
    const deadline = Math.floor(Date.now() / 1000) + 86400;
    const marketRes = await postJson(app, "/markets", {
      title: "Redemption test market",
      description: "alice wins",
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
    const market = await marketRes.json() as {
      id: string;
      group_pubkey_yes: string;
      group_pubkey_no: string;
    };

    // Both bet
    await postJson(app, `/markets/${market.id}/bet`, {
      side: "yes",
      amount_sats: BET_SATS,
      bettor_pubkey: ALICE_PK,
    });
    const bobBetRes = await postJson(app, `/markets/${market.id}/bet`, {
      side: "no",
      amount_sats: BET_SATS,
      bettor_pubkey: BOB_PK,
    });
    const bobBet = await bobBetRes.json() as {
      matches: Array<{
        pair_id: string;
        counterparty_pubkey: string;
        group_pubkey_yes: string;
        group_pubkey_no: string;
        locktime_exchange: number;
        locktime_market: number;
        amount_sats: number;
      }>;
    };
    const match = bobBet.matches[0]!;

    // Both create P2PK-locked tokens. Alice locks YES tokens (redeemable
    // by Bob if NO wins); Bob locks NO tokens (redeemable by Alice if YES
    // wins). We only care about Bob's token here — Alice will redeem it.
    const aliceToken = await createLockedToken(aliceWallet, aliceProofs, {
      mintUrl: MINT_URL,
      marketGroupPubkeyYes: market.group_pubkey_yes,
      marketGroupPubkeyNo: market.group_pubkey_no,
      myPubkey: ALICE_PK,
      mySide: "yes",
      counterpartyPubkey: BOB_PK,
      amountSats: BET_SATS,
      exchangeLocktime: match.locktime_exchange,
      marketLocktime: match.locktime_market,
    });
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

    await postJson(app, `/markets/${market.id}/submit-token`, {
      pair_id: match.pair_id,
      cashu_token: aliceToken.token,
      bettor_pubkey: ALICE_PK,
    });
    await postJson(app, `/markets/${market.id}/submit-token`, {
      pair_id: match.pair_id,
      cashu_token: bobToken.token,
      bettor_pubkey: BOB_PK,
    });

    // Resolve YES
    const resolveRes = await postJson(app, `/markets/${market.id}/resolve`, {
      outcome: "yes",
    });
    expect(resolveRes.status).toBe(200);

    // === Alice redeems Bob's token ===
    const knownKeysetIds = aliceWallet.keyChain.getAllKeysetIds();
    const decoded = getDecodedToken(bobToken.token, knownKeysetIds);
    const proofs = decoded.proofs;
    expect(proofs.length).toBeGreaterThan(0);

    // Get oracle signatures for each proof's secret.
    const signRes = await postJson(app, `/markets/${market.id}/sign-proofs`, {
      pubkey: ALICE_PK,
      proof_secrets: proofs.map((p) => p.secret),
    });
    expect(signRes.status).toBe(200);
    const signed = await signRes.json() as {
      oracle_signatures: Record<string, string>;
      signed_count: number;
    };
    expect(signed.signed_count).toBe(proofs.length);

    // Pre-fill each proof's witness with the oracle's signature, then
    // signP2PKProofs adds Alice's signature → n_sigs=2 satisfied.
    const proofsWithOracleSig = proofs.map((p) => ({
      ...p,
      witness: JSON.stringify({
        signatures: [signed.oracle_signatures[p.secret]],
      }),
    }));
    const fullySigned = signP2PKProofs(proofsWithOracleSig, alice.secretKey);

    // === Cryptographic precondition: each proof has 2 valid signatures ===
    expect(market.group_pubkey_yes).toBeTruthy();
    const groupYesXOnly = hexToBytes(market.group_pubkey_yes);
    const aliceXOnly = hexToBytes(ALICE_PK);
    for (const p of fullySigned) {
      const w = typeof p.witness === "string"
        ? JSON.parse(p.witness)
        : p.witness;
      expect(Array.isArray(w.signatures)).toBe(true);
      expect(w.signatures.length).toBe(2);

      const msg = sha256(new TextEncoder().encode(p.secret));
      const oracleVerifies = w.signatures.some((sigHex: string) =>
        schnorr.verify(hexToBytes(sigHex), msg, groupYesXOnly)
      );
      expect(oracleVerifies).toBe(true);

      const aliceVerifies = w.signatures.some((sigHex: string) =>
        schnorr.verify(hexToBytes(sigHex), msg, aliceXOnly)
      );
      expect(aliceVerifies).toBe(true);
    }

    // === Actually swap at the mint and assert alice receives the sats ===
    const reencoded = getEncodedToken({ mint: MINT_URL, proofs: fullySigned });
    const fresh = await aliceWallet.receive(reencoded);
    const winnings = fresh.reduce((s, p) => s + p.amount, 0);

    // Alice's balance grew by Bob's locked amount minus the mint's swap fee.
    // Nutshell on regtest charges input_fee_ppk=100 (≈1 sat per ~10 inputs).
    expect(winnings).toBeGreaterThan(0);
    expect(winnings).toBeLessThanOrEqual(BET_SATS);
    expect(winnings).toBeGreaterThanOrEqual(BET_SATS - 5);
    void bytesToHex;
  });

  test("loser cannot redeem — oracle refuses to sign for the wrong side", async () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const ALICE_PK = alice.publicKey;
    const BOB_PK = bob.publicKey;

    const aliceWallet = await createWallet(MINT_URL);
    const bobWallet = await createWallet(MINT_URL);
    const serverWallet = await createWallet(MINT_URL);
    const aliceProofs: Proof[] = await throttledMintProofs(aliceWallet, 256);
    const bobProofs: Proof[] = await throttledMintProofs(bobWallet, 256);

    const state = createMarketState();
    state.getCashuWallet = async () => serverWallet;
    const app = buildApp(state);

    const deadline = Math.floor(Date.now() / 1000) + 86400;
    const marketRes = await postJson(app, "/markets", {
      title: "Loser-cannot-redeem test",
      description: "yes wins; bob (no) loses",
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
    const market = await marketRes.json() as { id: string };

    await postJson(app, `/markets/${market.id}/bet`, {
      side: "yes",
      amount_sats: 200,
      bettor_pubkey: ALICE_PK,
    });
    const bobBetRes = await postJson(app, `/markets/${market.id}/bet`, {
      side: "no",
      amount_sats: 200,
      bettor_pubkey: BOB_PK,
    });
    const bobBet = await bobBetRes.json() as {
      matches: Array<
        {
          pair_id: string;
          counterparty_pubkey: string;
          group_pubkey_yes: string;
          group_pubkey_no: string;
          locktime_exchange: number;
          locktime_market: number;
          amount_sats: number;
        }
      >;
    };
    const match = bobBet.matches[0]!;

    const aliceToken = await createLockedToken(aliceWallet, aliceProofs, {
      mintUrl: MINT_URL,
      marketGroupPubkeyYes: match.group_pubkey_yes,
      marketGroupPubkeyNo: match.group_pubkey_no,
      myPubkey: ALICE_PK,
      mySide: "yes",
      counterpartyPubkey: BOB_PK,
      amountSats: 200,
      exchangeLocktime: match.locktime_exchange,
      marketLocktime: match.locktime_market,
    });
    const bobToken = await createLockedToken(bobWallet, bobProofs, {
      mintUrl: MINT_URL,
      marketGroupPubkeyYes: match.group_pubkey_yes,
      marketGroupPubkeyNo: match.group_pubkey_no,
      myPubkey: BOB_PK,
      mySide: "no",
      counterpartyPubkey: ALICE_PK,
      amountSats: 200,
      exchangeLocktime: match.locktime_exchange,
      marketLocktime: match.locktime_market,
    });
    await postJson(app, `/markets/${market.id}/submit-token`, {
      pair_id: match.pair_id,
      cashu_token: aliceToken.token,
      bettor_pubkey: ALICE_PK,
    });
    await postJson(app, `/markets/${market.id}/submit-token`, {
      pair_id: match.pair_id,
      cashu_token: bobToken.token,
      bettor_pubkey: BOB_PK,
    });

    await postJson(app, `/markets/${market.id}/resolve`, { outcome: "yes" });

    // Bob (loser) tries to redeem Alice's token. Server should refuse.
    const decoded = getDecodedToken(
      aliceToken.token,
      bobWallet.keyChain.getAllKeysetIds(),
    );
    const tryRes = await postJson(app, `/markets/${market.id}/sign-proofs`, {
      pubkey: BOB_PK,
      proof_secrets: decoded.proofs.map((p) => p.secret),
    });
    expect(tryRes.status).toBe(403);
  });
});
