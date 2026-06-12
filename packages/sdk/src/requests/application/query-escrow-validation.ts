import type { EscrowProvider } from "./ports.ts";
import type { Query } from "../domain/types.ts";

export interface EscrowTokenLockResult {
  ok: boolean;
  message?: string;
}

/**
 * CTF-2: Without this check, a customer could submit a token locked to
 * their own key instead of the provider's, then redeem after preimage is
 * revealed.
 */
export async function verifyEscrowLock(
  escrowProvider: EscrowProvider,
  escrowRef: string,
  paymentHash: string,
  providerPubkey: string,
): Promise<EscrowTokenLockResult> {
  return escrowProvider.verifyLock(escrowRef, paymentHash, providerPubkey);
}

export { MIN_ESCROW_LOCKTIME_SECS } from "../domain/value-objects.ts";

export function isEscrowQuery(query: Query): boolean {
  return query.escrow !== undefined;
}

export interface EscrowAmountResult {
  valid: boolean;
  amountSats?: number;
  error?: string;
}

export async function verifyEscrowAmount(
  escrowProvider: EscrowProvider,
  escrowRef: string,
  expectedSats: number,
): Promise<EscrowAmountResult> {
  const check = await escrowProvider.verify(escrowRef, expectedSats);
  return {
    valid: check.valid,
    amountSats: check.amount_sats,
    error: check.error,
  };
}
