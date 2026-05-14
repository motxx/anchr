import type { EscrowProvider } from "./ports.ts";
import type { Query, QueryStatus } from "../domain/types.ts";

export interface EscrowTokenLockResult {
  ok: boolean;
  message?: string;
}

/**
 * CTF-2: Without this check, a requester could submit a token locked to
 * their own key instead of the worker's, then redeem after preimage is
 * revealed.
 */
export async function verifyEscrowLock(
  escrowProvider: EscrowProvider,
  escrowRef: string,
  paymentHash: string,
  workerPubkey: string,
): Promise<EscrowTokenLockResult> {
  return escrowProvider.verifyLock(escrowRef, paymentHash, workerPubkey);
}

export { MIN_ESCROW_LOCKTIME_SECS } from "../domain/value-objects.ts";

export const ESCROW_TRANSITIONS: Record<string, QueryStatus[]> = {
  awaiting_offers: ["worker_selected"],
  worker_selected: ["processing"],
  processing: ["verifying"],
  verifying: ["approved", "rejected"],
};

export function validateEscrowTransition(
  from: QueryStatus,
  to: QueryStatus,
): boolean {
  return ESCROW_TRANSITIONS[from]?.includes(to) ?? false;
}

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
