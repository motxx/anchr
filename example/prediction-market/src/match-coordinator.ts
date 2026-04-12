/**
 * Match coordinator — executes matched order pairs via cross-HTLC.
 *
 * Takes a MatchProposal from the order book and creates the actual
 * cross-HTLC escrow tokens using the protocol layer primitives.
 */

import type { Proof } from "@cashu/cashu-ts";
import type { ConditionalSwapDef } from "../../../src/domain/conditional-swap-types.ts";
import { createSwapPairTokens } from "../../../src/infrastructure/conditional-swap/cross-htlc.ts";
import type { MatchedBetPair, MatchProposal } from "./market-types.ts";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

/**
 * Execute a match proposal by creating cross-HTLC escrow tokens.
 *
 * @param proposal - Match proposal from the order book
 * @param yesProofs - YES bettor's Cashu proofs to lock
 * @param noProofs - NO bettor's Cashu proofs to lock
 * @param swap - Conditional swap definition (hashes + locktime)
 * @param yesPubkey - YES bettor's public key
 * @param noPubkey - NO bettor's public key
 * @param marketId - Market identifier
 */
export async function executeMatch(
  proposal: MatchProposal,
  yesProofs: Proof[],
  noProofs: Proof[],
  swap: ConditionalSwapDef,
  yesPubkey: string,
  noPubkey: string,
  marketId: string,
): Promise<MatchedBetPair | null> {
  // YES bettor is party_a, NO bettor is party_b in ConditionalSwap terms
  // hash_a = hash_yes (A redeems B's tokens if YES wins)
  // hash_b = hash_no  (B redeems A's tokens if NO wins)
  const tokens = await createSwapPairTokens(
    yesProofs,
    noProofs,
    proposal.amount_sats,
    swap,
    yesPubkey,
    noPubkey,
  );

  if (!tokens) return null;

  return {
    pair_id: bytesToHex(randomBytes(16)),
    market_id: marketId,
    yes_pubkey: yesPubkey,
    no_pubkey: noPubkey,
    amount_sats: proposal.amount_sats,
    // token_yes_to_no = tokenAtoB (YES bettor's tokens, redeemable by NO if NO wins)
    token_yes_to_no: tokens.tokenAtoB.token,
    // token_no_to_yes = tokenBtoA (NO bettor's tokens, redeemable by YES if YES wins)
    token_no_to_yes: tokens.tokenBtoA.token,
    status: "locked",
  };
}
