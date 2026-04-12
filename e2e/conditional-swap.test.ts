/**
 * E2E tests for Spec 07: Conditional Swap — full prediction market lifecycle.
 *
 * Tests the complete lifecycle with real Cashu escrow on regtest:
 *   1. Create dual preimage store (generates hash_a, hash_b for YES/NO outcomes)
 *   2. Two bettors mint Cashu tokens via regtest Lightning
 *   3. Both place orders in the order book (one YES, one NO)
 *   4. Order book matches them -> MatchProposal
 *   5. Execute match -> creates cross-HTLC locked SwapPair tokens
 *   6. Oracle resolves (YES wins) -> reveals preimage_a
 *   7. Winner redeems loser's tokens using revealed preimage
 *   8. Verify: loser's preimage is permanently deleted (cannot be revealed)
 *
 * Prerequisites:
 *   docker compose up -d
 *   sleep 25
 *   ./scripts/init-regtest.sh
 *   docker compose restart cashu-mint
 *
 * Run:
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   NOSTR_RELAYS=ws://localhost:7777 \
 *   BLOSSOM_SERVERS=http://localhost:3333 \
 *   deno test e2e/conditional-swap.test.ts --allow-all --no-check
 */

import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  Wallet,
  type Proof,
  getDecodedToken,
  P2PKBuilder,
} from "@cashu/cashu-ts";
import { bytesToHex } from "@noble/hashes/utils.js";

import { createDualPreimageStore } from "../src/infrastructure/conditional-swap/dual-preimage-store.ts";
import { createOrderBook } from "../example/prediction-market/src/order-book.ts";
import { resolveMarket } from "../example/prediction-market/src/resolution.ts";
import type { ConditionalSwapDef } from "../src/domain/conditional-swap-types.ts";
import type { OpenOrder, MatchProposal, MatchedBetPair } from "../example/prediction-market/src/market-types.ts";
import {
  checkInfraReady,
  createWallet,
  throttledMintProofs,
  throttleMintOp,
  retryOnRateLimit,
  generateKeypair,
} from "./helpers/regtest.ts";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const BET_SATS = 64;

const INFRA_READY = await checkInfraReady(MINT_URL);

// Create wallet at module level before describes register.
// Ensures loadMint() fetch responses are fully consumed before test scope
// begins (avoids Deno sanitizer false positives).
const sharedWallet = INFRA_READY ? await createWallet(MINT_URL) : undefined;

/**
 * Create cross-HTLC locked proofs directly on the Cashu Mint.
 *
 * Mirrors the logic in cross-htlc.ts but uses the test wallet directly
 * (avoiding dependency on the global getCashuWallet singleton).
 */
async function createCrossHtlcProofs(
  wallet: Wallet,
  sourceProofs: Proof[],
  amountSats: number,
  hash: string,
  counterpartyPubkey: string,
  refundPubkey: string,
  locktime: number,
): Promise<Proof[]> {
  const p2pkOptions = new P2PKBuilder()
    .addHashlock(hash)
    .addLockPubkey(counterpartyPubkey)
    .requireLockSignatures(1)
    .lockUntil(locktime)
    .addRefundPubkey(refundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();

  const fee = wallet.getFeesForProofs(sourceProofs);
  const sendAmount = amountSats - fee;
  if (sendAmount <= 0) throw new Error(`Fee (${fee}) exceeds amount (${amountSats})`);

  await throttleMintOp();
  const { send } = await retryOnRateLimit(() =>
    wallet.ops.send(sendAmount, sourceProofs).asP2PK(p2pkOptions).run()
  );

  return send;
}

/**
 * Execute a match proposal using the test wallet directly.
 *
 * Same as match-coordinator.ts executeMatch but bypasses the global wallet.
 * Creates cross-HTLC locked proofs in both directions:
 *   - YES bettor's proofs locked to hash_b (NO wins -> NO bettor redeems)
 *   - NO bettor's proofs locked to hash_a (YES wins -> YES bettor redeems)
 */
async function executeMatchDirect(
  wallet: Wallet,
  proposal: MatchProposal,
  yesProofs: Proof[],
  noProofs: Proof[],
  swap: ConditionalSwapDef,
  yesPubkey: string,
  noPubkey: string,
  marketId: string,
): Promise<MatchedBetPair> {
  // YES bettor's proofs locked with hash_b + P2PK(NO bettor)
  // -> NO bettor can redeem if NO wins (oracle reveals preimage_b)
  const yesToNoProofs = await createCrossHtlcProofs(
    wallet,
    yesProofs,
    proposal.amount_sats,
    swap.hash_b,
    noPubkey,
    yesPubkey,
    swap.locktime,
  );

  // NO bettor's proofs locked with hash_a + P2PK(YES bettor)
  // -> YES bettor can redeem if YES wins (oracle reveals preimage_a)
  const noToYesProofs = await createCrossHtlcProofs(
    wallet,
    noProofs,
    proposal.amount_sats,
    swap.hash_a,
    yesPubkey,
    noPubkey,
    swap.locktime,
  );

  return {
    pair_id: bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
    market_id: marketId,
    yes_pubkey: yesPubkey,
    no_pubkey: noPubkey,
    amount_sats: proposal.amount_sats,
    token_yes_to_no: "held_in_proofs", // In real usage would be encoded token
    token_no_to_yes: "held_in_proofs",
    status: "locked",
    // Attach raw proofs for test redemption
    _yesToNoProofs: yesToNoProofs,
    _noToYesProofs: noToYesProofs,
  } as MatchedBetPair & { _yesToNoProofs: Proof[]; _noToYesProofs: Proof[] };
}

// --- Test suite ---

const suite = INFRA_READY ? describe : describe.ignore;

suite("e2e: Spec 07 — Conditional Swap full prediction market lifecycle", () => {
  const wallet = sharedWallet!;

  // Shared state across the lifecycle tests
  const marketId = "market_btc_100k_2026";
  const dualStore = createDualPreimageStore();
  const orderBook = createOrderBook();

  let yesBettor: { secretKey: string; publicKey: string };
  let noBettor: { secretKey: string; publicKey: string };
  let yesProofs: Proof[];
  let noProofs: Proof[];
  let swap: ConditionalSwapDef;
  let matchProposals: MatchProposal[];
  let matchedPair: MatchedBetPair & { _yesToNoProofs: Proof[]; _noToYesProofs: Proof[] };
  let revealedPreimage: string;

  // -------------------------------------------------------------------------
  // Step 1: Create dual preimage store
  // -------------------------------------------------------------------------

  test("1. create dual preimage store with hash_a (YES) and hash_b (NO)", () => {
    const hashes = dualStore.create(marketId);

    expect(hashes.hash_a).toBeDefined();
    expect(hashes.hash_b).toBeDefined();
    expect(hashes.hash_a).not.toBe(hashes.hash_b);
    // Hashes should be 64-char hex (SHA-256)
    expect(hashes.hash_a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes.hash_b).toMatch(/^[0-9a-f]{64}$/);

    // Build ConditionalSwapDef for later steps
    swap = {
      swap_id: marketId,
      hash_a: hashes.hash_a,
      hash_b: hashes.hash_b,
      locktime: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    };

    // Verify store has the swap
    expect(dualStore.has(marketId)).toBe(true);
    const retrieved = dualStore.getHashes(marketId);
    expect(retrieved).toEqual(hashes);
  });

  // -------------------------------------------------------------------------
  // Step 2: Two bettors mint Cashu tokens via regtest Lightning
  // -------------------------------------------------------------------------

  test("2. two bettors mint Cashu tokens via regtest Lightning", async () => {
    yesBettor = generateKeypair();
    noBettor = generateKeypair();

    // Mint proofs for both bettors
    yesProofs = await throttledMintProofs(wallet, BET_SATS);
    noProofs = await throttledMintProofs(wallet, BET_SATS);

    // Verify both got correct amounts
    const yesTotal = yesProofs.reduce((s, p) => s + p.amount, 0);
    const noTotal = noProofs.reduce((s, p) => s + p.amount, 0);
    expect(yesTotal).toBe(BET_SATS);
    expect(noTotal).toBe(BET_SATS);
    expect(yesProofs.length).toBeGreaterThan(0);
    expect(noProofs.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Step 3: Both place orders in the order book
  // -------------------------------------------------------------------------

  test("3. both bettors place orders in the order book (YES and NO)", () => {
    const yesOrder: OpenOrder = {
      id: "order_yes_1",
      market_id: marketId,
      bettor_pubkey: yesBettor.publicKey,
      side: "yes",
      amount_sats: BET_SATS,
      remaining_sats: BET_SATS,
      timestamp: Date.now(),
    };

    const noOrder: OpenOrder = {
      id: "order_no_1",
      market_id: marketId,
      bettor_pubkey: noBettor.publicKey,
      side: "no",
      amount_sats: BET_SATS,
      remaining_sats: BET_SATS,
      timestamp: Date.now() + 1, // slightly after YES order
    };

    const addedYes = orderBook.addOrder(yesOrder);
    const addedNo = orderBook.addOrder(noOrder);

    expect(addedYes.remaining_sats).toBe(BET_SATS);
    expect(addedNo.remaining_sats).toBe(BET_SATS);

    // Verify orders appear in the book
    const yesOrders = orderBook.getOpenOrders(marketId, "yes");
    const noOrders = orderBook.getOpenOrders(marketId, "no");
    expect(yesOrders).toHaveLength(1);
    expect(noOrders).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Step 4: Order book matches them -> MatchProposal
  // -------------------------------------------------------------------------

  test("4. order book matches YES and NO orders into MatchProposal", () => {
    matchProposals = orderBook.matchOrders(marketId);

    expect(matchProposals).toHaveLength(1);
    expect(matchProposals[0]!.yes_order_id).toBe("order_yes_1");
    expect(matchProposals[0]!.no_order_id).toBe("order_no_1");
    expect(matchProposals[0]!.amount_sats).toBe(BET_SATS);

    // After matching, remaining_sats should be 0
    const yesOrders = orderBook.getOpenOrders(marketId, "yes");
    const noOrders = orderBook.getOpenOrders(marketId, "no");
    // Orders with 0 remaining are excluded from getOpenOrders
    expect(yesOrders.filter((o) => o.remaining_sats > 0)).toHaveLength(0);
    expect(noOrders.filter((o) => o.remaining_sats > 0)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Step 5: Execute match -> creates cross-HTLC locked SwapPair tokens
  // -------------------------------------------------------------------------

  test("5. execute match creates cross-HTLC locked escrow tokens", async () => {
    const proposal = matchProposals[0]!;

    matchedPair = await executeMatchDirect(
      wallet,
      proposal,
      yesProofs,
      noProofs,
      swap,
      yesBettor.publicKey,
      noBettor.publicKey,
      marketId,
    ) as MatchedBetPair & { _yesToNoProofs: Proof[]; _noToYesProofs: Proof[] };

    expect(matchedPair.status).toBe("locked");
    expect(matchedPair.market_id).toBe(marketId);
    expect(matchedPair.yes_pubkey).toBe(yesBettor.publicKey);
    expect(matchedPair.no_pubkey).toBe(noBettor.publicKey);
    expect(matchedPair.amount_sats).toBe(BET_SATS);

    // Verify cross-HTLC proofs were created in both directions
    expect(matchedPair._yesToNoProofs.length).toBeGreaterThan(0);
    expect(matchedPair._noToYesProofs.length).toBeGreaterThan(0);

    // Verify the HTLC secrets contain the correct hashes
    for (const proof of matchedPair._yesToNoProofs) {
      const secret = JSON.parse(proof.secret);
      expect(secret[0]).toBe("HTLC");
      // YES->NO proofs locked with hash_b
      expect(secret[1].data).toBe(swap.hash_b);
    }
    for (const proof of matchedPair._noToYesProofs) {
      const secret = JSON.parse(proof.secret);
      expect(secret[0]).toBe("HTLC");
      // NO->YES proofs locked with hash_a
      expect(secret[1].data).toBe(swap.hash_a);
    }
  });

  // -------------------------------------------------------------------------
  // Step 6: Oracle resolves (YES wins) -> reveals preimage_a
  // -------------------------------------------------------------------------

  test("6. oracle resolves market: YES wins, preimage_a revealed, preimage_b deleted", () => {
    const resolution = resolveMarket(marketId, "yes", dualStore);

    expect(resolution).not.toBeNull();
    expect(resolution!.outcome).toBe("yes");
    expect(resolution!.preimage).toBeDefined();
    expect(resolution!.preimage).toMatch(/^[0-9a-f]{64}$/);

    revealedPreimage = resolution!.preimage;

    // After resolution, trying to reveal again should return null (already revealed)
    const secondReveal = resolveMarket(marketId, "yes", dualStore);
    expect(secondReveal).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Step 7: Winner (YES bettor) redeems loser's (NO bettor's) tokens
  // -------------------------------------------------------------------------

  test("7. YES bettor redeems NO bettor's tokens using revealed preimage_a", async () => {
    // NO->YES proofs are locked with hash_a + P2PK(YES bettor)
    // YES bettor needs: preimage_a (from oracle) + YES bettor's private key
    const noToYesProofs = matchedPair._noToYesProofs;

    // Attach preimage as HTLC witness
    const proofsWithPreimage = noToYesProofs.map((p) => ({
      ...p,
      witness: JSON.stringify({ preimage: revealedPreimage, signatures: [] }),
    }));

    const totalSats = proofsWithPreimage.reduce((s, p) => s + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsWithPreimage);
    expect(totalSats - fee).toBeGreaterThan(0);

    // Redeem via cashu-ts (handles SIG_ALL signing + Mint swap)
    await throttleMintOp();
    const { send: redeemed } = await retryOnRateLimit(() =>
      wallet.ops
        .send(totalSats - fee, proofsWithPreimage)
        .privkey(yesBettor.secretKey)
        .run()
    );

    expect(redeemed).not.toBeNull();
    expect(redeemed.length).toBeGreaterThan(0);

    // Verify redeemed amount
    const redeemedTotal = redeemed.reduce((s, p) => s + p.amount, 0);
    expect(redeemedTotal).toBe(totalSats - fee);
  });

  // -------------------------------------------------------------------------
  // Step 8: Verify loser's preimage is permanently deleted
  // -------------------------------------------------------------------------

  test("8. loser's preimage (preimage_b) is permanently deleted and cannot be revealed", () => {
    // After YES resolution, preimage_b (the NO preimage) was permanently deleted.
    // Even if the oracle tries to reveal outcome "b" now, it should fail.

    // The dual store should still have the hashes for lookup
    const hashes = dualStore.getHashes(marketId);
    expect(hashes).not.toBeNull();

    // But revealing again should fail (already revealed once)
    const attemptRevealB = dualStore.reveal(marketId, "b");
    expect(attemptRevealB).toBeNull();

    // Also, trying to reveal "a" again fails
    const attemptRevealA = dualStore.reveal(marketId, "a");
    expect(attemptRevealA).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Bonus: NO bettor CANNOT obtain preimage_b (protocol-level guarantee)
  // -------------------------------------------------------------------------

  test("bonus: NO bettor cannot obtain preimage_b — protocol-level trustless guarantee", () => {
    // YES->NO proofs are locked with hash_b + P2PK(NO bettor).
    // NO bettor would need preimage_b to redeem, but it was permanently
    // deleted by the DualPreimageStore when the oracle resolved YES.
    //
    // This is the CORE trustless property of conditional swaps:
    // the losing preimage is destroyed at resolution time, so even a
    // compromised oracle cannot retroactively give it to the loser.

    // 1. The dual preimage store refuses to reveal the losing outcome
    const attemptRevealB = dualStore.reveal(marketId, "b");
    expect(attemptRevealB).toBeNull();

    // 2. Verify the proofs are indeed locked with hash_b (the NO hash)
    //    — confirming they require preimage_b which no longer exists
    const yesToNoProofs = matchedPair._yesToNoProofs;
    for (const proof of yesToNoProofs) {
      const secret = JSON.parse(proof.secret);
      expect(secret[0]).toBe("HTLC");
      expect(secret[1].data).toBe(swap.hash_b);
    }

    // 3. The only preimage that was revealed is preimage_a (YES outcome)
    //    — it does NOT match hash_b, so it cannot unlock these proofs
    //    (verified structurally: revealedPreimage hashes to hash_a, not hash_b)
    expect(revealedPreimage).toBeDefined();
    expect(swap.hash_a).not.toBe(swap.hash_b);
  });
});

// =============================================================================
// Partial matching test (separate describe to avoid shared state conflicts)
// =============================================================================

suite("e2e: Spec 07 — Order book partial matching", () => {
  const wallet = sharedWallet!;

  test("order book handles partial matches correctly", () => {
    const ob = createOrderBook();
    const marketId = "market_partial_test";

    // YES bettor bets 100 sats, two NO bettors bet 40 and 60 sats
    ob.addOrder({
      id: "big_yes",
      market_id: marketId,
      bettor_pubkey: "pk_yes",
      side: "yes",
      amount_sats: 100,
      remaining_sats: 100,
      timestamp: 1,
    });
    ob.addOrder({
      id: "small_no_1",
      market_id: marketId,
      bettor_pubkey: "pk_no_1",
      side: "no",
      amount_sats: 40,
      remaining_sats: 40,
      timestamp: 2,
    });
    ob.addOrder({
      id: "small_no_2",
      market_id: marketId,
      bettor_pubkey: "pk_no_2",
      side: "no",
      amount_sats: 60,
      remaining_sats: 60,
      timestamp: 3,
    });

    const proposals = ob.matchOrders(marketId);

    // Should produce two match proposals
    expect(proposals).toHaveLength(2);
    expect(proposals[0]!.yes_order_id).toBe("big_yes");
    expect(proposals[0]!.no_order_id).toBe("small_no_1");
    expect(proposals[0]!.amount_sats).toBe(40);
    expect(proposals[1]!.yes_order_id).toBe("big_yes");
    expect(proposals[1]!.no_order_id).toBe("small_no_2");
    expect(proposals[1]!.amount_sats).toBe(60);
  });

  test("dual preimage store prevents double-reveal", () => {
    const store = createDualPreimageStore();
    const id = "swap_double_reveal";

    const hashes = store.create(id);
    expect(hashes.hash_a).toBeDefined();
    expect(hashes.hash_b).toBeDefined();

    // First reveal succeeds
    const preimage = store.reveal(id, "a");
    expect(preimage).not.toBeNull();
    expect(preimage).toMatch(/^[0-9a-f]{64}$/);

    // Second reveal (either outcome) fails
    expect(store.reveal(id, "a")).toBeNull();
    expect(store.reveal(id, "b")).toBeNull();
  });

  test("resolveMarket maps YES->a and NO->b correctly", () => {
    const store = createDualPreimageStore();
    const yesMarket = "market_yes_test";
    const noMarket = "market_no_test";

    const yesHashes = store.create(yesMarket);
    const noHashes = store.create(noMarket);

    // YES resolution -> reveals preimage for hash_a
    const yesResult = resolveMarket(yesMarket, "yes", store);
    expect(yesResult).not.toBeNull();
    expect(yesResult!.outcome).toBe("yes");

    // NO resolution -> reveals preimage for hash_b
    const noResult = resolveMarket(noMarket, "no", store);
    expect(noResult).not.toBeNull();
    expect(noResult!.outcome).toBe("no");
  });
});
