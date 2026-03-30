/**
 * E2E tests: HTLC trustless properties on a real Cashu Mint.
 *
 * These tests attempt ACTUAL fraud against the Cashu Mint
 * and verify that NUT-11 P2PK + NUT-14 HTLC reject every attack.
 *
 *   1. Oracle tries to redeem with preimage only (no Worker sig) → REJECTED
 *   2. Worker tries to redeem without preimage → REJECTED
 *   3. Wrong Worker tries to redeem with correct preimage → REJECTED
 *   4. Worker redeems with correct preimage + correct sig → SUCCESS
 *   5. Double-spend: same proofs redeemed twice → REJECTED
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
 *   bun test e2e/regtest-htlc-trustless.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  Wallet,
  type Proof,
  getEncodedToken,
  getDecodedToken,
  P2PKBuilder,
} from "@cashu/cashu-ts";
import { createHTLCHash } from "@cashu/cashu-ts";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const AMOUNT_SATS = 64;

// --- Infrastructure helpers ---

async function isCashuMintReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${MINT_URL}/v1/info`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function isLndUserReachable(): Promise<boolean> {
  try {
    const proc = Bun.spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "getinfo",
    ], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function payInvoiceViaLndUser(bolt11: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "payinvoice", "--force", bolt11,
    ], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

// --- Crypto helpers ---

function generateKeypair() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { secretKey: bytesToHex(sk), publicKey: pk };
}

// --- Mint helpers ---

async function createWallet(): Promise<Wallet> {
  const wallet = new Wallet(MINT_URL, { unit: "sat" });
  await wallet.loadMint();
  return wallet;
}

async function mintProofs(wallet: Wallet, amountSats: number): Promise<Proof[]> {
  const mintQuote = await wallet.createMintQuote(amountSats);
  const paid = await payInvoiceViaLndUser(mintQuote.request);
  if (!paid) throw new Error("Failed to pay Lightning invoice via lnd-user");
  await Bun.sleep(2000);
  return wallet.mintProofs(amountSats, mintQuote.quote);
}

/**
 * Create HTLC-locked proofs on the real Cashu Mint.
 *
 * Condition: hash(preimage) AND Worker signature
 * Refund: Requester after locktime
 */
async function createHtlcProofs(
  wallet: Wallet,
  sourceProofs: Proof[],
  amountSats: number,
  hash: string,
  workerPubkey: string,
  requesterPubkey: string,
  locktimeSeconds: number,
): Promise<Proof[]> {
  const p2pkOptions = new P2PKBuilder()
    .addHashlock(hash)
    .addLockPubkey(workerPubkey)
    .requireLockSignatures(1)
    .lockUntil(locktimeSeconds)
    .addRefundPubkey(requesterPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();

  // Account for swap fees
  const fee = wallet.getFeesForProofs(sourceProofs);
  const sendAmount = amountSats - fee;
  if (sendAmount <= 0) throw new Error(`Fee (${fee}) exceeds amount (${amountSats})`);

  const { send } = await wallet.ops
    .send(sendAmount, sourceProofs)
    .asP2PK(p2pkOptions)
    .run();

  return send;
}

/**
 * Attempt to redeem HTLC proofs with given preimage and private key.
 * Returns redeemed proofs on success, null on failure.
 */
async function attemptRedeem(
  wallet: Wallet,
  htlcProofs: Proof[],
  preimage: string | undefined,
  privateKey: string | undefined,
): Promise<Proof[] | null> {
  try {
    // Set preimage witness on proofs
    const proofsWithWitness = htlcProofs.map((p) => ({
      ...p,
      witness: preimage
        ? JSON.stringify({ preimage, signatures: [] })
        : JSON.stringify({ signatures: [] }),
    }));

    const totalSats = proofsWithWitness.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsWithWitness);
    const amountSats = totalSats - fee;
    if (amountSats <= 0) return null;

    let op = wallet.ops.send(amountSats, proofsWithWitness);
    if (privateKey) {
      op = op.privkey(privateKey);
    }
    const { send } = await op.run();
    return send;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[redeem-attempt] Rejected by Mint: ${msg}`);
    return null;
  }
}

// =============================================================================

describe("e2e: HTLC trustless properties (real Cashu Mint)", () => {
  let mintReachable = false;
  let lndReachable = false;
  let wallet: Wallet;

  beforeAll(async () => {
    [mintReachable, lndReachable] = await Promise.all([
      isCashuMintReachable(),
      isLndUserReachable(),
    ]);
    if (!mintReachable || !lndReachable) {
      console.warn("[e2e] Infrastructure not ready – tests will be skipped.");
      console.warn("  Run: docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint");
      return;
    }
    wallet = await createWallet();
  });

  function skipIfNotReady() {
    if (!mintReachable || !lndReachable) {
      console.warn("[e2e] SKIPPED – infrastructure not ready");
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // 1. Oracle tries to redeem with preimage only (no Worker sig)
  // ---------------------------------------------------------------------------

  test("ATTACK: Oracle has preimage but no Worker key → Mint REJECTS", async () => {
    if (skipIfNotReady()) return;

    const worker = generateKeypair();
    const requester = generateKeypair();
    const oracle = generateKeypair(); // Oracle's own key (NOT the Worker's)
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    // Mint fresh proofs and lock with HTLC
    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Oracle attempts redemption: has preimage, uses Oracle's key (not Worker's)
    const result = await attemptRedeem(wallet, htlcProofs, preimage, oracle.secretKey);

    expect(result).toBeNull(); // Mint MUST reject — Oracle's key ≠ Worker's key
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 2. Worker tries to redeem without preimage
  // ---------------------------------------------------------------------------

  test("ATTACK: Worker has correct key but no preimage → Mint REJECTS", async () => {
    if (skipIfNotReady()) return;

    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Worker attempts redemption: correct key, but no preimage
    const result = await attemptRedeem(wallet, htlcProofs, undefined, worker.secretKey);

    expect(result).toBeNull(); // Mint MUST reject — no preimage
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 3. Wrong Worker tries to redeem with correct preimage
  // ---------------------------------------------------------------------------

  test("ATTACK: Wrong Worker has preimage but wrong key → Mint REJECTS", async () => {
    if (skipIfNotReady()) return;

    const worker = generateKeypair();
    const impostor = generateKeypair(); // different keypair
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Impostor attempts redemption: has preimage, but wrong private key
    const result = await attemptRedeem(wallet, htlcProofs, preimage, impostor.secretKey);

    expect(result).toBeNull(); // Mint MUST reject — impostor's key ≠ Worker's key
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 4. Worker redeems with correct preimage + correct sig → SUCCESS
  // ---------------------------------------------------------------------------

  test("LEGIT: Worker has preimage + correct key → Mint ACCEPTS", async () => {
    if (skipIfNotReady()) return;

    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Worker redeems: correct preimage + correct private key
    const result = await attemptRedeem(wallet, htlcProofs, preimage, worker.secretKey);

    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
    const redeemedSats = result!.reduce((sum, p) => sum + p.amount, 0);
    expect(redeemedSats).toBeGreaterThan(0);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 5. Double-spend: reuse same HTLC proofs after redemption
  // ---------------------------------------------------------------------------

  test("ATTACK: Reuse spent HTLC proofs → Mint REJECTS (double-spend)", async () => {
    if (skipIfNotReady()) return;

    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // First redemption: should succeed
    const first = await attemptRedeem(wallet, htlcProofs, preimage, worker.secretKey);
    expect(first).not.toBeNull();

    // Second redemption with same proofs: Mint MUST reject (already spent)
    const second = await attemptRedeem(wallet, htlcProofs, preimage, worker.secretKey);
    expect(second).toBeNull();
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 6. Wrong preimage with correct Worker key
  // ---------------------------------------------------------------------------

  test("ATTACK: Worker has correct key but wrong preimage → Mint REJECTS", async () => {
    if (skipIfNotReady()) return;

    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash } = createHTLCHash();
    const { preimage: wrongPreimage } = createHTLCHash(); // different preimage
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Worker attempts with wrong preimage (doesn't match hash)
    const result = await attemptRedeem(wallet, htlcProofs, wrongPreimage, worker.secretKey);

    expect(result).toBeNull(); // Mint MUST reject — wrong preimage
  }, 60_000);
});
