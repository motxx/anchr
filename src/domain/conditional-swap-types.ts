/**
 * Conditional Swap Types — the N:M primitive.
 *
 * Cross-HTLC dual-preimage pattern: Oracle generates two preimages for
 * binary outcomes (A/B). Matched pairs lock tokens in opposite directions.
 * Oracle reveals the winning preimage; winner redeems loser's tokens.
 *
 * 1:1 atomic swap is the special case where N=1, M=1.
 *
 * Use cases: prediction markets, insurance, group bounties, auctions.
 */

/** Binary outcome conditional swap definition. */
export interface ConditionalSwapDef {
  /** Unique swap identifier. */
  swap_id: string;
  /** Outcome A hash (e.g., YES). */
  hash_a: string;
  /** Outcome B hash (e.g., NO). */
  hash_b: string;
  /** Locktime as unix timestamp (seconds). After this, both sides refund. */
  locktime: number;
}

/** A matched pair within a conditional swap. */
export interface SwapPair {
  /** Unique pair identifier. */
  pair_id: string;
  /** Parent swap this pair belongs to. */
  swap_id: string;
  /** Party A's public key (hex). Locks to hash_b — counterparty redeems if B wins. */
  party_a_pubkey: string;
  /** Party B's public key (hex). Locks to hash_a — counterparty redeems if A wins. */
  party_b_pubkey: string;
  /** Amount in sats for this matched pair. */
  amount_sats: number;
  /** Escrow token: party_a -> party_b direction (redeemable by B if outcome B). */
  token_a_to_b: string;
  /** Escrow token: party_b -> party_a direction (redeemable by A if outcome A). */
  token_b_to_a: string;
  /** Current status of this pair. */
  status: "pending" | "locked" | "settled_a" | "settled_b" | "expired";
}
