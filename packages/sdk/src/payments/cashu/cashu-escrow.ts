/**
 * Cashu HTLC escrow for Anchr protocol (NUT-14).
 *
 * Canonical two-phase HTLC pattern:
 *
 *   Phase 1 (initial lock, Provider unknown):
 *     - Local-hold mode: plain proofs stay with the Customer and are
 *       never published before Provider selection.
 *     - Preselection-transfer mode: P2PK(Customer) proofs may be shown
 *       in a request so providers can inspect the payment_lock amount, but relay
 *       observers cannot spend them.
 *
 *   Phase 2 (after Provider selected, swap to bind Provider):
 *     HTLC: hashlock(hash) + P2PK(Provider) + locktime + refund(Customer)
 *     → Provider can redeem with preimage + Provider signature.
 *     → Anchr's redeem path rejects Oracle or impostor keys before mint swap.
 *
 *   Redemption:
 *     Provider provides preimage (from Oracle NIP-44 DM) + Provider signature.
 *
 *   Refund:
 *     Customer reclaims after locktime expires.
 *
 * Also exposes a 2-of-2(Oracle, Provider) P2PK escrow primitive for the
 * pre-HTLC settlement path used by SDK payment adapters.
 */

import {
  getDecodedToken,
  isHTLCSpendAuthorised,
  P2PKBuilder,
  type P2PKOptions,
  type Proof,
  signP2PKProofs,
  verifyHTLCHash,
  verifyHTLCSpendingConditions,
} from "@cashu/cashu-ts";
import {
  computeNetAmount,
  encodeProofs,
  getWalletAndConfig,
  loadAndSend,
  sumProofAmounts,
} from "./cashu-escrow-helpers.ts";
import { redeemSignedProofs } from "./redeem-swap.ts";

import { getLogger } from "../../internal/runtime/logger.ts";
import {
  buildHtlcFinalOptions,
  type HtlcInitialLockParams,
  type HtlcProviderBindParams,
} from "./cashu-htlc-options.ts";

const log = getLogger(["anchr", "cashu-escrow"]);

// --- 2-of-2 P2PK escrow primitive ---

export interface EscrowParams {
  /** Oracle's public key (hex). */
  oraclePubkey: string;
  /** Provider's public key (hex). */
  providerPubkey: string;
  /** Customer's public key for timeout refund (hex). */
  customerRefundPubkey: string;
  /** Locktime as unix timestamp (seconds). After this, customer can reclaim. */
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
  /** Token for the provider (payment_lock minus fee). */
  providerToken: string;
  /** Token for the oracle (fee). */
  oracleToken: string;
  /** Provider amount in sats. */
  providerAmountSats: number;
  /** Oracle fee in sats. */
  oracleFeeSats: number;
}

/**
 * Build P2PK options for the 2-of-2(Oracle, Provider) escrow with timeout
 * refund to Customer.
 */
export function buildEscrowP2PKOptions(params: EscrowParams): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey([params.oraclePubkey, params.providerPubkey])
    .requireLockSignatures(2)
    .lockUntil(params.locktimeSeconds)
    .addRefundPubkey(params.customerRefundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Create a P2PK-locked escrow token (2-of-2 Oracle + Provider).
 */
export async function createEscrowToken(
  amountSats: number,
  params: EscrowParams,
  sourceProofs: Proof[],
): Promise<EscrowToken | null> {
  const ctx = await getWalletAndConfig();
  if (!ctx) return null;

  const p2pkOptions = buildEscrowP2PKOptions(params);

  try {
    const send = await loadAndSend(
      ctx.wallet,
      amountSats,
      sourceProofs,
      p2pkOptions,
    );
    return {
      token: encodeProofs(ctx.config.mintUrl, send),
      proofs: send,
      p2pkOptions,
      amountSats,
    };
  } catch (error) {
    log.error(
      "Failed to create escrow token:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Execute the atomic swap: Oracle + Provider co-sign to split the escrowed token.
 */
export async function executeEscrowSwap(
  signedProofs: Proof[],
  providerPubkey: string,
  oraclePubkey: string,
  feeSats: number,
): Promise<SwapResult | null> {
  const ctx = await getWalletAndConfig();
  if (!ctx) return null;

  const totalSats = sumProofAmounts(signedProofs);
  const providerSats = totalSats - feeSats;

  if (providerSats <= 0) {
    log.error("Fee exceeds total amount");
    return null;
  }

  try {
    const providerP2PK = new P2PKBuilder().addLockPubkey(providerPubkey)
      .toOptions();
    const oracleP2PK = new P2PKBuilder().addLockPubkey(oraclePubkey)
      .toOptions();

    const providerProofs = await loadAndSend(
      ctx.wallet,
      providerSats,
      signedProofs,
      providerP2PK,
    );

    const remainingProofs = signedProofs.filter(
      (p) => !providerProofs.some((providerProof) => providerProof.C === p.C),
    );

    let oracleProofs: Proof[];
    if (remainingProofs.length > 0) {
      oracleProofs = await loadAndSend(
        ctx.wallet,
        feeSats,
        remainingProofs,
        oracleP2PK,
      );
    } else {
      oracleProofs = [];
    }

    return {
      providerToken: encodeProofs(ctx.config.mintUrl, providerProofs),
      oracleToken: oracleProofs.length > 0
        ? encodeProofs(ctx.config.mintUrl, oracleProofs)
        : "",
      providerAmountSats: providerSats,
      oracleFeeSats: feeSats,
    };
  } catch (error) {
    log.error("Swap failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

// --- HTLC escrow (NUT-14, per README architecture) ---

/**
 * Phase 1: Create hold token (Provider unknown).
 *
 * The Customer holds plain proofs locally until a Provider is selected. These
 * are bearer instruments and must not be published before Phase 2. Flows that
 * need to expose a preselection token should use
 * `buildHtlcPreselectionOptions()` with their own wallet adapter and require
 * the Customer's signature when binding the selected Provider.
 */
export async function createHtlcToken(
  amountSats: number,
  params: HtlcInitialLockParams,
  sourceProofs: Proof[],
): Promise<EscrowToken | null> {
  const ctx = await getWalletAndConfig();
  if (!ctx) return null;

  try {
    const send = await loadAndSend(ctx.wallet, amountSats, sourceProofs);
    return {
      token: encodeProofs(ctx.config.mintUrl, send),
      proofs: send,
      p2pkOptions: null,
      amountSats,
    };
  } catch (error) {
    log.error(
      "Failed to create initial hold token:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Phase 2: Swap HTLC token to bind a selected Provider.
 *
 * Takes the Phase 1 proofs and swaps them on the mint for new proofs
 * that require hashlock(preimage) + Provider signature to spend.
 */
export async function swapHtlcBindProvider(
  initialProofs: Proof[],
  params: HtlcProviderBindParams,
): Promise<EscrowToken | null> {
  const ctx = await getWalletAndConfig();
  if (!ctx) return null;

  const p2pkOptions = buildHtlcFinalOptions(params);

  try {
    const amountSats = computeNetAmount(ctx.wallet, initialProofs);
    if (amountSats === null) {
      log.error("Fee exceeds total amount");
      return null;
    }

    const send = await loadAndSend(
      ctx.wallet,
      amountSats,
      initialProofs,
      p2pkOptions,
    );
    return {
      token: encodeProofs(ctx.config.mintUrl, send),
      proofs: send,
      p2pkOptions,
      amountSats,
    };
  } catch (error) {
    log.error(
      "Failed to swap HTLC for provider binding:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Redeem HTLC token: Provider provides preimage + Provider signature.
 *
 * The Provider receives the preimage from the Oracle via NIP-44 DM after
 * verification passes. Combined with the Provider's signature, this satisfies
 * the HTLC spending conditions (NUT-14).
 *
 * Steps:
 *   1. Set preimage as HTLC witness on each proof
 *   2. Sign proofs with Provider's private key (P2PK witness)
 *   3. **Server-side verification** of HTLC conditions (hashlock + P2PK)
 *   4. Swap signed proofs for fresh, unlocked proofs on the mint
 *
 * Step 3 is load-bearing: Anchr verifies the Provider-bound P2PK authorization
 * before the network round-trip instead of relying on mint-specific witness
 * behavior.
 */
export async function redeemHtlcToken(
  htlcProofs: Proof[],
  preimage: string,
  providerPrivateKey: string,
): Promise<{ token: string; proofs: Proof[]; amountSats: number } | null> {
  const ctx = await getWalletAndConfig();
  if (!ctx) return null;

  let signedProofs: Proof[];
  try {
    signedProofs = prepareHtlcWitness(
      htlcProofs,
      preimage,
      providerPrivateKey,
    );
  } catch (error) {
    log.error(
      "Failed to prepare HTLC witness:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
  const verifyError = verifyHtlcSpendAuth(signedProofs);
  if (verifyError) return null;

  const redeem = await redeemSignedProofs({
    wallet: ctx.wallet,
    signedProofs,
    signingPrivateKey: providerPrivateKey,
  });
  if (!redeem.ok) {
    if (redeem.reason === "fee_exceeds_amount") {
      log.error("Fee exceeds total amount");
      return null;
    }
    if (redeem.reason !== "inputs_unspent" && redeem.uncertain) {
      throw new Error(
        "redeemHtlcToken: mint swap failed with inputs spent or unknowable — check the mint before retrying; do not treat the token as burned",
        { cause: redeem.cause },
      );
    }
    log.error(
      "Failed to redeem HTLC token (inputs unspent — safe to retry):",
      redeem.cause instanceof Error ? redeem.cause.message : redeem.cause,
    );
    return null;
  }
  return {
    token: encodeProofs(ctx.config.mintUrl, redeem.proofs),
    proofs: redeem.proofs,
    amountSats: redeem.amountSats,
  };
}

function prepareHtlcWitness(
  proofs: Proof[],
  preimage: string,
  providerPrivateKey: string,
): Proof[] {
  const proofsWithPreimage = proofs.map((p) => ({
    ...p,
    witness: JSON.stringify({ preimage, signatures: [] }),
  }));
  return signP2PKProofs(proofsWithPreimage, providerPrivateKey);
}

function verifyHtlcSpendAuth(signedProofs: Proof[]): string | null {
  for (const proof of signedProofs) {
    if (!isHTLCSpendAuthorised(proof)) {
      const detail = verifyHTLCSpendingConditions(proof);
      log.error("HTLC spending condition NOT met:", detail);
      return "HTLC spending condition not met";
    }
  }
  return null;
}

/**
 * Verify HTLC spending conditions on proofs without performing a swap.
 *
 * Used by the Oracle/server to verify that a set of HTLC proofs
 * have valid witness (preimage + signature) BEFORE revealing the preimage
 * or accepting the swap. Provides defense-in-depth alongside the Mint's
 * own NUT-14 enforcement (fail fast before network round-trip).
 *
 * @returns null if all proofs pass, or an error message describing the failure.
 */
export function verifyHtlcProofs(
  htlcProofs: Proof[],
  expectedHash: string,
  preimage: string,
): string | null {
  if (!verifyHTLCHash(preimage, expectedHash)) {
    return `Preimage does not match expected hash (hash=${expectedHash})`;
  }

  for (let i = 0; i < htlcProofs.length; i++) {
    const proof = htlcProofs[i]!;
    const secretError = validateHtlcSecret(proof, i, expectedHash);
    if (secretError) return secretError;

    if (proof.witness && !isHTLCSpendAuthorised(proof)) {
      return `Proof ${i}: HTLC spending conditions not met`;
    }
  }

  return null;
}

function validateHtlcSecret(
  proof: Proof,
  index: number,
  expectedHash: string,
): string | null {
  try {
    const secret = JSON.parse(proof.secret);
    if (!Array.isArray(secret) || secret[0] !== "HTLC") {
      return `Proof ${index}: not an HTLC proof`;
    }
    const data = secret[1]?.data;
    if (data !== expectedHash) {
      return `Proof ${index}: hashlock mismatch (expected=${expectedHash}, got=${data})`;
    }
  } catch {
    return `Proof ${index}: invalid secret format`;
  }
  return null;
}

/**
 * Calculate oracle fee from payment_lock amount and fee rate.
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
    const amountSats = sumProofAmounts(decoded.proofs);
    return {
      amountSats,
      proofCount: decoded.proofs.length,
      mintUrl: decoded.mint,
    };
  } catch {
    return null;
  }
}
