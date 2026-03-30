/**
 * Cashu HTLC escrow for Anchr protocol (NUT-14).
 *
 * Two-phase HTLC pattern (per README):
 *
 *   Phase 1 (initial lock, Worker unknown):
 *     HTLC: hashlock(hash) + locktime + refund(Requester)
 *     → Only Requester holds this token; not yet spendable by anyone.
 *
 *   Phase 2 (after Worker selected, swap to bind Worker):
 *     HTLC: hashlock(hash) + P2PK(Worker) + locktime + refund(Requester)
 *     → Worker can redeem with preimage + Worker signature.
 *     → Oracle cannot steal: knows preimage but not Worker's private key.
 *
 *   Redemption:
 *     Worker provides preimage (from Oracle NIP-44 DM) + Worker signature.
 *
 *   Refund:
 *     Requester reclaims after locktime expires.
 *
 * Also retains the legacy 2-of-2(Oracle, Worker) P2PK escrow for backward compat.
 */

import {
  P2PKBuilder,
  type Proof,
  type P2PKOptions,
  getEncodedToken,
  getDecodedToken,
  verifyHTLCSpendingConditions,
  isHTLCSpendAuthorised,
  signP2PKProofs,
  verifyHTLCHash,
} from "@cashu/cashu-ts";
import { getCashuWallet, getCashuConfig } from "./wallet";

// --- Legacy P2PK escrow (retained for backward compatibility) ---

export interface EscrowParams {
  /** Oracle's public key (hex). */
  oraclePubkey: string;
  /** Worker's public key (hex). */
  workerPubkey: string;
  /** Requester's public key for timeout refund (hex). */
  requesterRefundPubkey: string;
  /** Locktime as unix timestamp (seconds). After this, requester can reclaim. */
  locktimeSeconds: number;
}

export interface EscrowToken {
  /** Encoded Cashu token string. */
  token: string;
  /** Raw proofs. */
  proofs: Proof[];
  /** The P2PK options used (null for Phase 1 plain proofs). */
  p2pkOptions: P2PKOptions | null;
  /** Total amount in sats. */
  amountSats: number;
}

export interface SwapResult {
  /** Token for the worker (bounty minus fee). */
  workerToken: string;
  /** Token for the oracle (fee). */
  oracleToken: string;
  /** Worker amount in sats. */
  workerAmountSats: number;
  /** Oracle fee in sats. */
  oracleFeeSats: number;
}

/**
 * Build P2PK options for legacy escrow: 2-of-2(Oracle, Worker) + timeout refund to Requester.
 */
export function buildEscrowP2PKOptions(params: EscrowParams): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey([params.oraclePubkey, params.workerPubkey])
    .requireLockSignatures(2)
    .lockUntil(params.locktimeSeconds)
    .addRefundPubkey(params.requesterRefundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Create a P2PK-locked escrow token (legacy 2-of-2).
 */
export async function createEscrowToken(
  amountSats: number,
  params: EscrowParams,
  sourceProofs: Proof[],
): Promise<EscrowToken | null> {
  const wallet = getCashuWallet();
  const config = getCashuConfig();
  if (!wallet || !config) return null;

  const p2pkOptions = buildEscrowP2PKOptions(params);

  try {
    await wallet.loadMint();
    const { send } = await wallet.ops
      .send(amountSats, sourceProofs)
      .asP2PK(p2pkOptions)
      .run();

    const token = getEncodedToken({ mint: config.mintUrl, proofs: send });
    return {
      token,
      proofs: send,
      p2pkOptions,
      amountSats,
    };
  } catch (error) {
    console.error("[cashu-escrow] Failed to create escrow token:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Execute the atomic swap (legacy): Oracle + Worker co-sign to split the escrowed token.
 */
export async function executeEscrowSwap(
  signedProofs: Proof[],
  workerPubkey: string,
  oraclePubkey: string,
  feeSats: number,
): Promise<SwapResult | null> {
  const wallet = getCashuWallet();
  const config = getCashuConfig();
  if (!wallet || !config) return null;

  const totalSats = signedProofs.reduce((sum, p) => sum + p.amount, 0);
  const workerSats = totalSats - feeSats;

  if (workerSats <= 0) {
    console.error("[cashu-escrow] Fee exceeds total amount");
    return null;
  }

  try {
    await wallet.loadMint();

    const workerP2PK = new P2PKBuilder().addLockPubkey(workerPubkey).toOptions();
    const oracleP2PK = new P2PKBuilder().addLockPubkey(oraclePubkey).toOptions();

    const { send: workerProofs } = await wallet.ops
      .send(workerSats, signedProofs)
      .asP2PK(workerP2PK)
      .run();

    const remainingProofs = signedProofs.filter(
      (p) => !workerProofs.some((wp) => wp.C === p.C),
    );

    let oracleProofs: Proof[];
    if (remainingProofs.length > 0) {
      const { send } = await wallet.ops
        .send(feeSats, remainingProofs)
        .asP2PK(oracleP2PK)
        .run();
      oracleProofs = send;
    } else {
      oracleProofs = [];
    }

    return {
      workerToken: getEncodedToken({ mint: config.mintUrl, proofs: workerProofs }),
      oracleToken: oracleProofs.length > 0
        ? getEncodedToken({ mint: config.mintUrl, proofs: oracleProofs })
        : "",
      workerAmountSats: workerSats,
      oracleFeeSats: feeSats,
    };
  } catch (error) {
    console.error("[cashu-escrow] Swap failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

// --- HTLC escrow (NUT-14, per README architecture) ---

/** Parameters for Phase 1: initial HTLC lock before Worker is known. */
export interface HtlcInitialLockParams {
  /** SHA-256 hash of preimage (from Oracle). */
  hash: string;
  /** Requester's public key (hex) — used as placeholder lock + refund. */
  requesterPubkey: string;
  /** Locktime as unix timestamp (seconds). */
  locktimeSeconds: number;
}

/** Parameters for Phase 2: HTLC swap to bind a selected Worker. */
export interface HtlcWorkerBindParams {
  /** SHA-256 hash of preimage. */
  hash: string;
  /** Worker's public key (hex) — spending requires Worker signature + preimage. */
  workerPubkey: string;
  /** Requester's public key for timeout refund (hex). */
  requesterRefundPubkey: string;
  /** Locktime as unix timestamp (seconds). */
  locktimeSeconds: number;
}

/**
 * Build P2PK options for Phase 1: Hold token before Worker is known.
 *
 * Returns null — Phase 1 uses plain (unlocked) proofs. The Requester
 * holds them locally as bearer instruments. No P2PK or hashlock is
 * applied because:
 *   - Adding hashlock would require preimage to swap (Requester doesn't have it)
 *   - Adding P2PK(Requester) would require witness signing for swap
 *
 * The "escrow" aspect comes only in Phase 2 when HTLC conditions are applied.
 */
export function buildHtlcInitialOptions(params: HtlcInitialLockParams): null {
  // Phase 1: no conditions — plain proofs held locally by Requester.
  // params.hash is retained for Phase 2 but not used here.
  return null;
}

/**
 * Build P2PK options for Phase 2: HTLC with Worker bound.
 *
 * hashlock(hash) + P2PK(Worker) + locktime + refund(Requester).
 * Worker redeems with preimage + Worker signature.
 */
export function buildHtlcFinalOptions(params: HtlcWorkerBindParams): P2PKOptions {
  return new P2PKBuilder()
    .addHashlock(params.hash)
    .addLockPubkey(params.workerPubkey)
    .requireLockSignatures(1)
    .lockUntil(params.locktimeSeconds)
    .addRefundPubkey(params.requesterRefundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Phase 1: Create hold token (Worker unknown).
 *
 * The Requester holds plain (unlocked) proofs locally until a Worker
 * is selected. These are bearer instruments — no P2PK or hashlock.
 * Phase 2 (swapHtlcBindWorker) adds the HTLC conditions.
 */
export async function createHtlcToken(
  amountSats: number,
  params: HtlcInitialLockParams,
  sourceProofs: Proof[],
): Promise<EscrowToken | null> {
  const wallet = getCashuWallet();
  const config = getCashuConfig();
  if (!wallet || !config) return null;

  try {
    await wallet.loadMint();
    // Phase 1: plain proofs, no spending conditions
    const { send } = await wallet.ops
      .send(amountSats, sourceProofs)
      .run();

    const token = getEncodedToken({ mint: config.mintUrl, proofs: send });
    return { token, proofs: send, p2pkOptions: null, amountSats };
  } catch (error) {
    console.error("[cashu-htlc] Failed to create initial hold token:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Phase 2: Swap HTLC token to bind a selected Worker.
 *
 * Takes the Phase 1 proofs and swaps them on the mint for new proofs
 * that require hashlock(preimage) + Worker signature to spend.
 */
export async function swapHtlcBindWorker(
  initialProofs: Proof[],
  params: HtlcWorkerBindParams,
): Promise<EscrowToken | null> {
  const wallet = getCashuWallet();
  const config = getCashuConfig();
  if (!wallet || !config) return null;

  const p2pkOptions = buildHtlcFinalOptions(params);

  try {
    await wallet.loadMint();
    const totalSats = initialProofs.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(initialProofs);
    const amountSats = totalSats - fee;
    if (amountSats <= 0) {
      console.error("[cashu-htlc] Fee exceeds total amount");
      return null;
    }

    const { send } = await wallet.ops
      .send(amountSats, initialProofs)
      .asP2PK(p2pkOptions)
      .run();

    const token = getEncodedToken({ mint: config.mintUrl, proofs: send });
    return { token, proofs: send, p2pkOptions, amountSats };
  } catch (error) {
    console.error("[cashu-htlc] Failed to swap HTLC for worker binding:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Redeem HTLC token: Worker provides preimage + Worker signature.
 *
 * The Worker receives the preimage from the Oracle via NIP-44 DM after
 * C2PA verification passes. Combined with the Worker's signature, this
 * satisfies the HTLC spending conditions (NUT-14).
 *
 * Steps:
 *   1. Set preimage as HTLC witness on each proof
 *   2. Sign proofs with Worker's private key (P2PK witness)
 *   3. **Server-side verification** of HTLC conditions (hashlock + P2PK)
 *   4. Swap signed proofs for fresh, unlocked proofs on the mint
 *
 * Step 3 is critical: Nutshell 0.19.2 does NOT enforce NUT-14 spending
 * conditions on /v1/swap, so we verify locally before sending to the Mint.
 */
export async function redeemHtlcToken(
  htlcProofs: Proof[],
  preimage: string,
  workerPrivateKey: string,
): Promise<{ token: string; proofs: Proof[]; amountSats: number } | null> {
  const wallet = getCashuWallet();
  const config = getCashuConfig();
  if (!wallet || !config) return null;

  try {
    await wallet.loadMint();

    // 1. Set HTLC preimage witness on each proof
    const proofsWithPreimage = htlcProofs.map((p) => ({
      ...p,
      witness: JSON.stringify({ preimage, signatures: [] }),
    }));

    // 2. Sign proofs with Worker's private key
    const signedProofs = signP2PKProofs(proofsWithPreimage, workerPrivateKey);

    // 3. Server-side HTLC verification (defense against Mint enforcement gap)
    for (const proof of signedProofs) {
      if (!isHTLCSpendAuthorised(proof)) {
        const detail = verifyHTLCSpendingConditions(proof);
        console.error("[cashu-htlc] HTLC spending condition NOT met:", detail);
        return null;
      }
    }

    const totalSats = signedProofs.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(signedProofs);
    const amountSats = totalSats - fee;
    if (amountSats <= 0) {
      console.error("[cashu-htlc] Fee exceeds total amount");
      return null;
    }

    // 4. Swap verified proofs on the Mint
    const { send } = await wallet.ops
      .send(amountSats, signedProofs)
      .privkey(workerPrivateKey)
      .run();

    const token = getEncodedToken({ mint: config.mintUrl, proofs: send });
    return { token, proofs: send, amountSats };
  } catch (error) {
    console.error("[cashu-htlc] Failed to redeem HTLC token:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Verify HTLC spending conditions on proofs without performing a swap.
 *
 * Used by the Oracle/server to verify that a set of HTLC proofs
 * have valid witness (preimage + signature) BEFORE revealing the preimage
 * or accepting the swap. This compensates for Mints that don't enforce
 * NUT-14 spending conditions.
 *
 * @returns null if all proofs pass, or an error message describing the failure.
 */
export function verifyHtlcProofs(
  htlcProofs: Proof[],
  expectedHash: string,
  preimage: string,
): string | null {
  // 1. Verify preimage matches expected hash
  if (!verifyHTLCHash(preimage, expectedHash)) {
    return `Preimage does not match expected hash (hash=${expectedHash})`;
  }

  // 2. Verify each proof's HTLC secret and spending authorization
  for (let i = 0; i < htlcProofs.length; i++) {
    const proof = htlcProofs[i];
    try {
      const secret = JSON.parse(proof.secret);
      if (!Array.isArray(secret) || secret[0] !== "HTLC") {
        return `Proof ${i}: not an HTLC proof`;
      }
      const data = secret[1]?.data;
      if (data !== expectedHash) {
        return `Proof ${i}: hashlock mismatch (expected=${expectedHash}, got=${data})`;
      }
    } catch {
      return `Proof ${i}: invalid secret format`;
    }

    // 3. If proof has witness, verify P2PK + HTLC spending authorization
    if (proof.witness) {
      if (!isHTLCSpendAuthorised(proof)) {
        return `Proof ${i}: HTLC spending conditions not met`;
      }
    }
  }

  return null;
}

/**
 * Calculate oracle fee from bounty amount and fee rate.
 */
export function calculateOracleFee(amountSats: number, feePpm: number): number {
  return Math.ceil((amountSats * feePpm) / 1_000_000);
}

/**
 * Decode an escrow token and inspect its conditions.
 */
export function inspectEscrowToken(token: string): {
  amountSats: number;
  proofCount: number;
  mintUrl: string;
} | null {
  try {
    const decoded = getDecodedToken(token);
    const amountSats = decoded.proofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);
    return {
      amountSats,
      proofCount: decoded.proofs.length,
      mintUrl: decoded.mint,
    };
  } catch {
    return null;
  }
}
