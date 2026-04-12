/**
 * Market resolution — reveals the winning preimage via DualPreimageStore.
 *
 * Oracle determines the outcome, reveals the winning preimage, and
 * permanently deletes the losing one. Winners use the preimage to
 * redeem their cross-HTLC tokens via redeemHtlcToken().
 */

import type { DualPreimageStore } from "../../../src/infrastructure/conditional-swap/dual-preimage-store.ts";

export interface ResolutionResult {
  /** The revealed preimage for the winning outcome. */
  preimage: string;
  /** Which outcome won. */
  outcome: "yes" | "no";
}

/**
 * Resolve a prediction market.
 *
 * Maps prediction market outcomes to conditional swap outcomes:
 *   YES wins → outcome "a" (hash_a = hash_yes)
 *   NO wins  → outcome "b" (hash_b = hash_no)
 *
 * The winning preimage is returned. The losing preimage is permanently deleted
 * and can never be retrieved — this is what makes the swap trustless.
 *
 * @param market_id - Market / swap identifier
 * @param outcome - Determined outcome ("yes" or "no")
 * @param dualPreimageStore - Dual preimage store holding both preimages
 */
export function resolveMarket(
  market_id: string,
  outcome: "yes" | "no",
  dualPreimageStore: DualPreimageStore,
): ResolutionResult | null {
  // Map prediction market outcome to conditional swap outcome
  const swapOutcome = outcome === "yes" ? "a" : "b";

  const preimage = dualPreimageStore.reveal(market_id, swapOutcome);
  if (!preimage) return null;

  return { preimage, outcome };
}
