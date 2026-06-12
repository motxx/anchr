/**
 * E2E: interrupted redeem swap recovery on a real Cashu Mint.
 *
 * A network error must never burn a token: when the mint commits the redeem
 * swap but the HTTP response is lost, `redeemHtlc` checks the input state,
 * restores the pre-registered outputs via NUT-09, and returns the fresh
 * proofs instead of reporting total loss.
 *
 * Prerequisites: same Docker regtest stack as the other regtest suites.
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createHTLCHash,
  getEncodedToken,
  P2PKBuilder,
  type Proof,
  Wallet,
} from "@cashu/cashu-ts";
import { hexToBytes } from "@noble/hashes/utils.js";
import { createCashuClient } from "@anchr/sdk";
import {
  checkInfraReady,
  createWallet as createRegtestWallet,
  generateKeypair,
  retryOnRateLimit,
  throttledMintProofs,
  throttleMintOp,
} from "../helpers/regtest.ts";
import process from "node:process";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const AMOUNT_SATS = 64;

async function createHtlcProofs(
  wallet: Wallet,
  sourceProofs: Proof[],
  amountSats: number,
  hash: string,
  providerPubkey: string,
  customerPubkey: string,
  locktimeSeconds: number,
): Promise<Proof[]> {
  const p2pkOptions = new P2PKBuilder()
    .addHashlock(hash)
    .addLockPubkey(providerPubkey)
    .requireLockSignatures(1)
    .lockUntil(locktimeSeconds)
    .addRefundPubkey(customerPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();

  const fee = wallet.getFeesForProofs(sourceProofs);
  const sendAmount = amountSats - fee;
  if (sendAmount <= 0) {
    throw new Error(`Fee (${fee}) exceeds amount (${amountSats})`);
  }

  await throttleMintOp();
  const { send } = await retryOnRateLimit(() =>
    wallet.ops.send(sendAmount, sourceProofs).asP2PK(p2pkOptions).run()
  );
  return send;
}

const INFRA_READY = await checkInfraReady(MINT_URL);

const suite = INFRA_READY ? describe : describe.ignore;

const sharedWallet = INFRA_READY
  ? await createRegtestWallet(MINT_URL)
  : undefined;

suite("e2e: interrupted redeem swap recovery (real Cashu Mint)", () => {
  const wallet = sharedWallet!;

  test("a committed swap whose response is lost recovers the outputs — never silent loss", async () => {
    const provider = generateKeypair();
    const customer = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await throttledMintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet,
      sourceProofs,
      AMOUNT_SATS,
      hash,
      provider.publicKey,
      customer.publicKey,
      locktime,
    );
    const token = getEncodedToken({ mint: MINT_URL, proofs: htlcProofs });

    const client = createCashuClient({ mintUrl: MINT_URL });

    // The mint receives and commits the swap, but the response never
    // reaches the SDK.
    const realFetch = globalThis.fetch;
    let interceptedSwaps = 0;
    const interceptingFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
      if (url.includes("/v1/swap")) {
        interceptedSwaps += 1;
        const res = await realFetch(input, init);
        await res.body?.cancel();
        throw new Error("simulated response loss after mint commit");
      }
      return await realFetch(input, init);
    };
    globalThis.fetch = interceptingFetch;

    try {
      await throttleMintOp();
      const result = await client.redeemHtlc({
        token,
        preimageHex: preimage,
        providerSecretKey: hexToBytes(provider.secretKey),
      });

      expect(interceptedSwaps).toBeGreaterThan(0);
      // The redeem recovered the committed outputs via NUT-09 restore.
      expect(result.proofs.length).toBeGreaterThan(0);
      expect(result.amountSats).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
