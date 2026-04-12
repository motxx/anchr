/**
 * Market resolution — supports both HTLC preimage and FROST P2PK modes.
 *
 * HTLC mode: Oracle reveals the winning preimage via DualPreimageStore.
 * FROST P2PK mode: Oracle signs with the winning outcome's key via DualKeyStore.
 *
 * In both modes the losing side's secret is permanently deleted.
 */

import type { DualPreimageStore } from "../../../src/infrastructure/conditional-swap/dual-preimage-store.ts";
import type { DualKeyStore } from "../../../src/infrastructure/conditional-swap/frost-conditional-swap.ts";

export interface ResolutionResult {
  /** The revealed preimage for the winning outcome. (HTLC mode) */
  preimage: string;
  /** Which outcome won. */
  outcome: "yes" | "no";
}

export interface FrostResolutionResult {
  /** Oracle's Schnorr signature for the winning outcome. (FROST P2PK mode) */
  oracle_signature: string;
  /** Which outcome won. */
  outcome: "yes" | "no";
}

/**
 * Resolve a prediction market using HTLC preimage mode.
 *
 * Maps prediction market outcomes to conditional swap outcomes:
 *   YES wins -> outcome "a" (hash_a = hash_yes)
 *   NO wins  -> outcome "b" (hash_b = hash_no)
 *
 * The winning preimage is returned. The losing preimage is permanently deleted
 * and can never be retrieved -- this is what makes the swap trustless.
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

/**
 * Resolve a prediction market using FROST P2PK mode.
 *
 * Oracle signs a message with the winning outcome's group key.
 * The signature serves as the Oracle's attestation that the outcome occurred.
 * Winners attach this signature + their own signature to redeem at the mint.
 *
 * @param market_id - Market / swap identifier
 * @param outcome - Determined outcome ("yes" or "no")
 * @param dualKeyStore - Dual key store holding both keypairs
 */
export function resolveMarketFrost(
  market_id: string,
  outcome: "yes" | "no",
  dualKeyStore: DualKeyStore,
): FrostResolutionResult | null {
  const swapOutcome = outcome === "yes" ? "a" : "b";
  const message = new TextEncoder().encode(`${market_id}:${outcome}`);

  const signature = dualKeyStore.sign(market_id, swapOutcome, message);
  if (!signature) return null;

  return { oracle_signature: signature, outcome };
}
