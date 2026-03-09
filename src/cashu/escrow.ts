/**
 * Cashu P2PK escrow for Anchr protocol.
 *
 * Implements the 1-token escrow pattern:
 *   Lock:    2-of-2(Oracle, Worker) with timeout refund to Requester
 *   Pass:    Oracle + Worker co-sign swap → bounty split (worker reward + oracle fee)
 *   Fail:    Nobody signs → timeout → Requester reclaims
 *
 * Uses NUT-11 P2PK spending conditions via @cashu/cashu-ts P2PKBuilder.
 */

import {
  P2PKBuilder,
  type Proof,
  type P2PKOptions,
  getEncodedToken,
  getDecodedToken,
} from "@cashu/cashu-ts";
import { getCashuWallet, getCashuConfig } from "./wallet";

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
  /** The P2PK options used. */
  p2pkOptions: P2PKOptions;
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
 * Build P2PK options for escrow: 2-of-2(Oracle, Worker) + timeout refund to Requester.
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
 * Create a P2PK-locked escrow token.
 *
 * The token can only be spent by both Oracle and Worker signing together.
 * After locktime, the Requester can reclaim with their refund key.
 *
 * Requires an existing funded wallet (proofs available).
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
 * Execute the atomic swap: Oracle + Worker co-sign to split the escrowed token.
 *
 * Both parties must sign the proofs before calling this.
 * The swap produces two outputs:
 *   1. Worker reward (amountSats - feeSats) locked to workerPubkey
 *   2. Oracle fee (feeSats) locked to oraclePubkey
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

    // Swap into two P2PK outputs: worker reward + oracle fee
    const workerP2PK = new P2PKBuilder().addLockPubkey(workerPubkey).toOptions();
    const oracleP2PK = new P2PKBuilder().addLockPubkey(oraclePubkey).toOptions();

    // Use the wallet's swap to split into two outputs
    const { send: workerProofs } = await wallet.ops
      .send(workerSats, signedProofs)
      .asP2PK(workerP2PK)
      .run();

    // The remaining proofs (change) should be fee amount for oracle
    const remainingProofs = signedProofs.filter(
      (p) => !workerProofs.some((wp) => wp.C === p.C),
    );

    // If there are remaining proofs, swap them to oracle
    let oracleProofs: Proof[];
    if (remainingProofs.length > 0) {
      const { send } = await wallet.ops
        .send(feeSats, remainingProofs)
        .asP2PK(oracleP2PK)
        .run();
      oracleProofs = send;
    } else {
      // Edge case: no remaining proofs, oracle gets nothing
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

/**
 * Calculate oracle fee from bounty amount and fee rate.
 */
export function calculateOracleFee(amountSats: number, feePpm: number): number {
  return Math.ceil((amountSats * feePpm) / 1_000_000);
}

/**
 * Decode an escrow token and inspect its P2PK conditions.
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
