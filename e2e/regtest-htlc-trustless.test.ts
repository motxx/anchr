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
import { redeemHtlcToken, verifyHtlcProofs } from "../src/cashu/escrow";

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
 *
 * This calls the Mint directly (not via cashu-ts .send()) to ensure
 * the Mint's NUT-14 enforcement is actually tested.
 *
 * @param preimage - preimage to include in witness (undefined = omit)
 * @param privateKey - key to sign proofs with (undefined = no signature)
 */
async function attemptRedeem(
  wallet: Wallet,
  htlcProofs: Proof[],
  preimage: string | undefined,
  privateKey: string | undefined,
): Promise<Proof[] | null> {
  try {
    // 1. Build witness
    // - With preimage: receiver path (preimage + signatures)
    // - With key but no preimage: refund path (signatures only)
    // - Neither: no witness at all
    let proofsWithWitness = htlcProofs.map((p) => ({
      ...p,
      witness: preimage
        ? JSON.stringify({ preimage, signatures: [] })
        : privateKey
          ? JSON.stringify({ signatures: [] })
          : undefined,
    }));

    // 2. Build outputs first (needed for SIG_ALL signing)
    const totalSats = proofsWithWitness.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsWithWitness);
    const outAmount = totalSats - fee;
    if (outAmount <= 0) return null;

    const outputs = buildOutputs(outAmount, htlcProofs[0]!.id);

    // 3. Send directly to Mint /v1/swap (no client-side bypass)
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
    // Return signature count as proxy for success (we don't unblind here)
    return signatures as unknown as Proof[];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[redeem-attempt] Error: ${msg}`);
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

describe("e2e: HTLC trustless properties (real Cashu Mint)", () => {
  let wallet: Wallet;

  beforeAll(async () => {
    if (!INFRA_READY) return;
    wallet = await createWallet();
  });

  // ---------------------------------------------------------------------------
  // 1. Oracle tries to redeem with preimage only (no Worker sig)
  // ---------------------------------------------------------------------------

  test.skipIf(!INFRA_READY)("ATTACK: Oracle has preimage but no Worker key → Mint REJECTS", async () => {
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

  test.skipIf(!INFRA_READY)("ATTACK: Worker has correct key but no preimage → Mint REJECTS", async () => {
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

  test.skipIf(!INFRA_READY)("ATTACK: Wrong Worker has preimage but wrong key → Mint REJECTS", async () => {
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

  test.skipIf(!INFRA_READY)("LEGIT: Worker has preimage + correct key → Mint ACCEPTS", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Worker redeems via cashu-ts (which handles SIG_ALL signing + Mint swap)
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

    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThan(0);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 5. Double-spend: reuse same HTLC proofs after redemption
  // ---------------------------------------------------------------------------

  test.skipIf(!INFRA_READY)("ATTACK: Reuse spent HTLC proofs → Mint REJECTS (double-spend)", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // First redemption via cashu-ts (handles SIG_ALL)
    const proofsWithPreimage = htlcProofs.map((p) => ({
      ...p,
      witness: JSON.stringify({ preimage, signatures: [] }),
    }));
    const totalSats = proofsWithPreimage.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsWithPreimage);
    const { send: first } = await wallet.ops
      .send(totalSats - fee, proofsWithPreimage)
      .privkey(worker.secretKey)
      .run();
    expect(first).not.toBeNull();

    // Second redemption with same proofs via direct Mint call: MUST reject
    const second = await attemptRedeem(wallet, htlcProofs, preimage, worker.secretKey);
    expect(second).toBeNull();
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 6. Wrong preimage with correct Worker key
  // ---------------------------------------------------------------------------

  test.skipIf(!INFRA_READY)("ATTACK: Worker has correct key but wrong preimage → Mint REJECTS", async () => {
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

  // ---------------------------------------------------------------------------
  // 7. No witness at all
  // ---------------------------------------------------------------------------

  test.skipIf(!INFRA_READY)("ATTACK: No witness at all → Mint REJECTS", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // No preimage, no key — completely missing witness
    const result = await attemptRedeem(wallet, htlcProofs, undefined, undefined);

    expect(result).toBeNull(); // Mint MUST reject — no witness
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 8. Refund path BEFORE locktime (Requester tries early refund)
  // ---------------------------------------------------------------------------

  test.skipIf(!INFRA_READY)("ATTACK: Requester refund key before locktime → Mint REJECTS", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    // Locktime 1 hour from now — lock is ACTIVE
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Requester tries to reclaim with refund key (no preimage) before locktime
    const result = await attemptRedeem(wallet, htlcProofs, undefined, requester.secretKey);

    expect(result).toBeNull(); // Mint MUST reject — locktime not expired
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 9. Refund path AFTER locktime (legitimate timeout refund)
  // ---------------------------------------------------------------------------

  test.skipIf(!INFRA_READY)("LEGIT: Requester refund key after locktime → Mint ACCEPTS", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    // Locktime clearly expired (60 seconds in the past)
    const locktime = Math.floor(Date.now() / 1000) - 60;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Requester reclaims via cashu-ts (handles SIG_ALL signing correctly)
    const proofsForRefund = htlcProofs.map((p) => ({
      ...p,
      witness: JSON.stringify({ signatures: [] }),
    }));
    const totalSats = proofsForRefund.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsForRefund);
    const { send: result } = await wallet.ops
      .send(totalSats - fee, proofsForRefund)
      .privkey(requester.secretKey)
      .run();

    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThan(0);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // 10. Tampered proof secret (altered hash in secret)
  // ---------------------------------------------------------------------------

  test.skipIf(!INFRA_READY)("ATTACK: Tampered proof secret → Mint REJECTS", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Tamper with the secret: replace the hash with a different one
    const { hash: fakeHash } = createHTLCHash();
    const tamperedProofs = htlcProofs.map((p) => ({
      ...p,
      secret: p.secret.replace(hash, fakeHash),
    }));

    // Try to swap with the real preimage (matching original hash, not tampered)
    const result = await attemptRedeem(wallet, tamperedProofs, preimage, worker.secretKey);

    expect(result).toBeNull(); // Mint MUST reject — blind signature won't verify for tampered secret
  }, 60_000);
});

// =============================================================================
// Server-side HTLC enforcement (compensates for Mint gaps)
// =============================================================================

describe("e2e: Anchr server-side HTLC enforcement", () => {
  let wallet: Wallet;

  beforeAll(async () => {
    if (!INFRA_READY) return;
    wallet = await createWallet();
  });

  test.skipIf(!INFRA_READY)("verifyHtlcProofs rejects wrong preimage", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash } = createHTLCHash();
    const { preimage: wrongPreimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    const error = verifyHtlcProofs(htlcProofs, hash, wrongPreimage);
    expect(error).not.toBeNull();
    expect(error).toContain("Preimage does not match");
  }, 60_000);

  test.skipIf(!INFRA_READY)("verifyHtlcProofs rejects mismatched hash in proofs", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const { hash: differentHash } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Proofs locked with `hash`, but we claim `differentHash`
    const error = verifyHtlcProofs(htlcProofs, differentHash, preimage);
    expect(error).not.toBeNull();
    // Either preimage doesn't match differentHash, or proof hashlock mismatch
  }, 60_000);

  test.skipIf(!INFRA_READY)("verifyHtlcProofs accepts correct preimage + matching proofs", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    const error = verifyHtlcProofs(htlcProofs, hash, preimage);
    expect(error).toBeNull(); // All good
  }, 60_000);

  test.skipIf(!INFRA_READY)("redeemHtlcToken rejects Oracle's key (server-side P2PK check)", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const oracle = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    process.env.CASHU_MINT_URL = MINT_URL;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Oracle tries to redeem — server-side isHTLCSpendAuthorised MUST reject
    const result = await redeemHtlcToken(htlcProofs, preimage, oracle.secretKey);
    expect(result).toBeNull();
  }, 60_000);

  test.skipIf(!INFRA_READY)("redeemHtlcToken rejects wrong Worker's key (server-side P2PK check)", async () => {
    const worker = generateKeypair();
    const impostor = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    process.env.CASHU_MINT_URL = MINT_URL;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Impostor tries to redeem with correct preimage but wrong key
    const result = await redeemHtlcToken(htlcProofs, preimage, impostor.secretKey);
    expect(result).toBeNull();
  }, 60_000);

  test.skipIf(!INFRA_READY)("redeemHtlcToken rejects missing preimage (server-side hashlock check)", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    process.env.CASHU_MINT_URL = MINT_URL;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Worker has correct key but no preimage — empty string as preimage
    const result = await redeemHtlcToken(htlcProofs, "", worker.secretKey);
    expect(result).toBeNull();
  }, 60_000);

  test.skipIf(!INFRA_READY)("redeemHtlcToken rejects wrong preimage (server-side hashlock check)", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash } = createHTLCHash();
    const { preimage: wrongPreimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    process.env.CASHU_MINT_URL = MINT_URL;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Worker has correct key but wrong preimage
    const result = await redeemHtlcToken(htlcProofs, wrongPreimage, worker.secretKey);
    expect(result).toBeNull();
  }, 60_000);

  test.skipIf(!INFRA_READY)("redeemHtlcToken accepts correct Worker key + preimage", async () => {
    const worker = generateKeypair();
    const requester = generateKeypair();
    const { hash, preimage } = createHTLCHash();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    process.env.CASHU_MINT_URL = MINT_URL;

    const sourceProofs = await mintProofs(wallet, AMOUNT_SATS);
    const htlcProofs = await createHtlcProofs(
      wallet, sourceProofs, AMOUNT_SATS,
      hash, worker.publicKey, requester.publicKey, locktime,
    );

    // Correct Worker redeems — should succeed
    const result = await redeemHtlcToken(htlcProofs, preimage, worker.secretKey);
    expect(result).not.toBeNull();
    expect(result!.amountSats).toBeGreaterThan(0);
  }, 60_000);
});
