/**
 * Cross-HTLC builder for conditional swaps.
 *
 * Builds P2PK options for dual-direction HTLC locks. Party A's token is
 * locked to hash_b (redeemable by B if outcome B wins), and vice versa.
 * Same P2PKBuilder pattern as escrow.ts:buildHtlcFinalOptions but with
 * hash and pubkey oriented in opposite directions.
 */

import {
  P2PKBuilder,
  type Proof,
  type P2PKOptions,
} from "@cashu/cashu-ts";
import type { EscrowToken } from "../cashu/escrow.ts";
import type { ConditionalSwapDef } from "../../domain/conditional-swap-types.ts";
import {
  getWalletAndConfig,
  encodeProofs,
  loadAndSend,
  computeNetAmount,
} from "../cashu/escrow-helpers.ts";

/**
 * Build P2PK options for party A's token.
 *
 * Party A locks tokens to hash_b — counterparty (B) redeems if outcome B wins.
 * hashlock(hash_b) + P2PK(counterpartyPubkey) + locktime + refund(refundPubkey).
 */
export function buildCrossHtlcForPartyA(params: {
  hash_b: string;
  counterpartyPubkey: string;
  refundPubkey: string;
  locktime: number;
}): P2PKOptions {
  return new P2PKBuilder()
    .addHashlock(params.hash_b)
    .addLockPubkey(params.counterpartyPubkey)
    .requireLockSignatures(1)
    .lockUntil(params.locktime)
    .addRefundPubkey(params.refundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Build P2PK options for party B's token.
 *
 * Party B locks tokens to hash_a — counterparty (A) redeems if outcome A wins.
 * hashlock(hash_a) + P2PK(counterpartyPubkey) + locktime + refund(refundPubkey).
 */
export function buildCrossHtlcForPartyB(params: {
  hash_a: string;
  counterpartyPubkey: string;
  refundPubkey: string;
  locktime: number;
}): P2PKOptions {
  return new P2PKBuilder()
    .addHashlock(params.hash_a)
    .addLockPubkey(params.counterpartyPubkey)
    .requireLockSignatures(1)
    .lockUntil(params.locktime)
    .addRefundPubkey(params.refundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Create both escrow tokens for a matched pair.
 *
 * - token_a_to_b: Party A's proofs locked with hash_b + P2PK(B) — B redeems if B wins.
 * - token_b_to_a: Party B's proofs locked with hash_a + P2PK(A) — A redeems if A wins.
 *
 * Returns null if the mint operation fails.
 */
export async function createSwapPairTokens(
  partyAProofs: Proof[],
  partyBProofs: Proof[],
  amount: number,
  swap: ConditionalSwapDef,
  partyAPubkey: string,
  partyBPubkey: string,
): Promise<{ tokenAtoB: EscrowToken; tokenBtoA: EscrowToken } | null> {
  const ctx = await getWalletAndConfig();
  if (!ctx) return null;

  const optionsAtoB = buildCrossHtlcForPartyA({
    hash_b: swap.hash_b,
    counterpartyPubkey: partyBPubkey,
    refundPubkey: partyAPubkey,
    locktime: swap.locktime,
  });

  const optionsBtoA = buildCrossHtlcForPartyB({
    hash_a: swap.hash_a,
    counterpartyPubkey: partyAPubkey,
    refundPubkey: partyBPubkey,
    locktime: swap.locktime,
  });

  try {
    const sendA = await loadAndSend(ctx.wallet, amount, partyAProofs, optionsAtoB);
    const sendB = await loadAndSend(ctx.wallet, amount, partyBProofs, optionsBtoA);

    const tokenAtoB: EscrowToken = {
      token: encodeProofs(ctx.config.mintUrl, sendA),
      proofs: sendA,
      p2pkOptions: optionsAtoB,
      amountSats: amount,
    };

    const tokenBtoA: EscrowToken = {
      token: encodeProofs(ctx.config.mintUrl, sendB),
      proofs: sendB,
      p2pkOptions: optionsBtoA,
      amountSats: amount,
    };

    return { tokenAtoB, tokenBtoA };
  } catch (error) {
    console.error(
      "[cross-htlc] Failed to create swap pair tokens:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
