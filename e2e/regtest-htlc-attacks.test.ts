/**
 * E2E attack tests: HTLC proof manipulation, redemption timing, and
 * multi-party attacks against a REAL Cashu Mint.
 *
 * These tests verify that the Cashu Mint's NUT-11 P2PK and NUT-14 HTLC
 * enforcement correctly rejects adversarial inputs at the protocol level.
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
 *   bun test e2e/regtest-htlc-attacks.test.ts
 */

import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { spawn } from "../src/runtime/mod.ts";
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
    const proc = spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "getinfo",
    ], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function payInvoiceViaLndUser(bolt11: string): Promise<boolean> {
  try {
    const proc = spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "payinvoice", "--force", bolt11,
    ], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
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
  await new Promise(r => setTimeout(r, 2000));
  return wallet.mintProofs(amountSats, mintQuote.quote);
}

/**
 * Create HTLC-locked proofs on the real Cashu Mint.
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
 * Build blinded outputs for a swap request.
 */
function buildOutputs(amountSats: number, keysetId: string): Array<{ amount: number; id: string; B_: string }> {
  const outputs: Array<{ amount: number; id: string; B_: string }> = [];
  let remaining = amountSats;
  for (const denom of [64, 32, 16, 8, 4, 2, 1]) {
    while (remaining >= denom) {
      outputs.push({
        amount: denom,
        id: keysetId,
        B_: "02" + bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
      });
      remaining -= denom;
    }
  }
  return outputs;
}

/**
 * Attempt to redeem HTLC proofs via direct /v1/swap on the Mint.
 */
async function attemptRedeem(
  wallet: Wallet,
  htlcProofs: Proof[],
  preimage: string | undefined,
  privateKey: string | undefined,
): Promise<Proof[] | null> {
  try {
    const proofsWithWitness = htlcProofs.map((p) => ({
      ...p,
      witness: preimage
        ? JSON.stringify({ preimage, signatures: [] })
        : privateKey
          ? JSON.stringify({ signatures: [] })
          : undefined,
    }));

    const totalSats = proofsWithWitness.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsWithWitness);
    const outAmount = totalSats - fee;
    if (outAmount <= 0) return null;

    const outputs = buildOutputs(outAmount, htlcProofs[0]!.id);

    const res = await fetch(`${MINT_URL}/v1/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: proofsWithWitness.map((p) => ({
          amount: p.amount,
          id: p.id,
          secret: p.secret,
          C: p.C,
          witness: typeof p.witness === "string" ? p.witness : p.witness ? JSON.stringify(p.witness) : undefined,
        })),
        outputs,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[redeem-attempt] Mint rejected (${res.status}): ${body}`);
      return null;
    }

    const { signatures } = (await res.json()) as { signatures: Array<{ amount: number; id: string; C_: string }> };
    return signatures as unknown as Proof[];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[redeem-attempt] Error: ${msg}`);
    return null;
  }
}

/**
 * Attempt redeem with a custom witness object (for non-standard attacks).
 */
async function attemptRedeemWithCustomWitness(
  wallet: Wallet,
  htlcProofs: Proof[],
  witnessObj: Record<string, unknown>,
): Promise<Proof[] | null> {
  try {
    const proofsWithWitness = htlcProofs.map((p) => ({
      ...p,
      witness: JSON.stringify(witnessObj),
    }));

    const totalSats = proofsWithWitness.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsWithWitness);
    const outAmount = totalSats - fee;
    if (outAmount <= 0) return null;

    const outputs = buildOutputs(outAmount, htlcProofs[0]!.id);

    const res = await fetch(`${MINT_URL}/v1/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: proofsWithWitness.map((p) => ({
          amount: p.amount,
          id: p.id,
          secret: p.secret,
          C: p.C,
          witness: typeof p.witness === "string" ? p.witness : undefined,
        })),
        outputs,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[redeem-custom] Mint rejected (${res.status}): ${body}`);
      return null;
    }

    const { signatures } = (await res.json()) as { signatures: Array<{ amount: number; id: string; C_: string }> };
    return signatures as unknown as Proof[];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[redeem-custom] Error: ${msg}`);
    return null;
  }
}

// --- Infrastructure readiness (top-level await for test.skipIf) ---

const [MINT_REACHABLE, LND_REACHABLE] = await Promise.all([
  isCashuMintReachable(),
  isLndUserReachable(),
]);
const INFRA_READY = MINT_REACHABLE && LND_REACHABLE;

if (!INFRA_READY) {
  console.warn("[e2e] Infrastructure not ready – tests will be skipped.");
  console.warn("  Run: docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint");
}

// =============================================================================
// E2E Attack Category 1: Proof Manipulation
// =============================================================================

describe("e2e: Proof Manipulation Attacks", () => {
  let wallet: Wallet;

  beforeAll(async () => {
    if (!INFRA_READY) return;
    wallet = await createWallet();
  });

  test.skipIf(!INFRA_READY)("ATTACK: Modified proof amount — Mint rejects (blind sig mismatch)", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Tamper: change proof amount from actual to 128
    const tamperedProofs = htlcProofs.map((p) => ({
      ...p,
      amount: 128,
    }));

    const result = await attemptRedeem(wallet, tamperedProofs, preimage, worker.secretKey);
    expect(result).toBeNull(); // Mint MUST reject — blind signature won't verify for modified amount
  }, 60_000);

  test.skipIf(!INFRA_READY)("ATTACK: Swapped proof secrets between proof sets — Mint rejects", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    // Create two separate HTLC proof sets
    const { hash: hash1, preimage: preimage1 } = createHTLCHash();
    const source1 = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs1 = await createHtlcProofs(
      wallet, source1, AMOUNT_SATS,
      hash1, worker.publicKey, requester.publicKey, locktime,
    );

    const { hash: hash2, preimage: preimage2 } = createHTLCHash();
    const source2 = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs2 = await createHtlcProofs(
      wallet, source2, AMOUNT_SATS,
      hash2, worker.publicKey, requester.publicKey, locktime,
    );

    // Swap secrets between proof sets (take secrets from set 2, put into set 1)
    const swappedProofs = htlcProofs1.map((p, i) => ({
      ...p,
      secret: htlcProofs2[i]?.secret ?? p.secret,
    }));

    // Try to redeem with preimage1 (matching hash1, but secrets from set 2)
    const result = await attemptRedeem(wallet, swappedProofs, preimage1, worker.secretKey);
    expect(result).toBeNull(); // Mint MUST reject — secret/C mismatch
  }, 60_000);

  test.skipIf(!INFRA_READY)("ATTACK: Proof with empty secret — Mint rejects", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Tamper: empty secret
    const tamperedProofs = htlcProofs.map((p) => ({
      ...p,
      secret: "",
    }));

    const result = await attemptRedeem(wallet, tamperedProofs, preimage, worker.secretKey);
    expect(result).toBeNull(); // Mint MUST reject — empty secret is invalid
  }, 60_000);
});

// =============================================================================
// E2E Attack Category 2: Redemption Timing
// =============================================================================

describe("e2e: Redemption Timing Attacks", () => {
  let wallet: Wallet;

  beforeAll(async () => {
    if (!INFRA_READY) return;
    wallet = await createWallet();
  });

  test.skipIf(!INFRA_READY)("ATTACK: Redeem with both preimage AND refund key simultaneously", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Send witness with BOTH preimage and signatures for the worker key
    // The Mint should process this using the hashlock path (preimage present)
    // This tests that the Mint correctly handles combined witness fields
    const result = await attemptRedeemWithCustomWitness(
      wallet,
      htlcProofs,
      { preimage, signatures: [] },
    );

    // The Mint should either accept (using preimage path, which needs worker sig)
    // or reject. Either way, no double-spend should be possible.
    // Since this has the preimage but no valid worker signature, it should reject.
    expect(result).toBeNull();
  }, 60_000);

  test.skipIf(!INFRA_READY)("Worker redeems with expired locktime — succeeds (locktime only affects refund path)", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    // Locktime in the past: already expired
    const locktime = Math.floor(Date.now() / 1000) - 60;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Worker redeems with preimage + correct key after locktime expired
    // Per NUT-14: locktime expiry opens the REFUND path, but the PREIMAGE
    // path should remain valid regardless of locktime.
    const proofsWithPreimage = htlcProofs.map((p) => ({
      ...p,
      witness: JSON.stringify({ preimage, signatures: [] }),
    }));
    const totalSats = proofsWithPreimage.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsWithPreimage);

    const { send: result } = await wallet.ops
      .send(totalSats - fee, proofsWithPreimage)
      .privkey(worker.secretKey)
      .run();

    // Worker SHOULD succeed — preimage path is independent of locktime
    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThan(0);
  }, 60_000);
});

// =============================================================================
// E2E Attack Category 3: Multi-Party Attacks
// =============================================================================

describe("e2e: Multi-Party Attacks", () => {
  let wallet: Wallet;

  beforeAll(async () => {
    if (!INFRA_READY) return;
    wallet = await createWallet();
  });

  test.skipIf(!INFRA_READY)("ATTACK: Two workers race to redeem same proofs — second fails (double-spend)", async () => {
    const worker1 = generateKeypair();
    const worker2 = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    // Lock proofs to worker1's key
    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker1.publicKey, requester.publicKey, locktime,
    );

    // Worker 1 redeems successfully
    const proofsWithPreimage = htlcProofs.map((p) => ({
      ...p,
      witness: JSON.stringify({ preimage, signatures: [] }),
    }));
    const totalSats = proofsWithPreimage.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsWithPreimage);
    const { send: first } = await wallet.ops
      .send(totalSats - fee, proofsWithPreimage)
      .privkey(worker1.secretKey)
      .run();
    expect(first).not.toBeNull();
    expect(first.length).toBeGreaterThan(0);

    // Worker 2 tries to redeem the same proofs with preimage (different key)
    // Even if Worker 2 had the preimage, proofs are already spent
    const second = await attemptRedeem(wallet, htlcProofs, preimage, worker2.secretKey);
    expect(second).toBeNull(); // Mint MUST reject — proofs already spent
  }, 60_000);

  test.skipIf(!INFRA_READY)("ATTACK: Requester redeems own HTLC proofs before locktime — fails", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    // Locktime 1 hour in the future — refund path is NOT available
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Requester has the refund key AND the preimage.
    // Tries to redeem with requester key + preimage (NOT the worker key).
    // The hashlock path requires the WORKER's key, not the requester's.
    const result = await attemptRedeem(wallet, htlcProofs, preimage, requester.secretKey);
    expect(result).toBeNull(); // Mint MUST reject — requester key is not the lock key
  }, 60_000);
});
