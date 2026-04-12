import type { EscrowProvider } from "./escrow-port";
import type { Query, QueryStatus } from "../domain/types";

export interface HtlcTokenLockResult {
  ok: boolean;
  message?: string;
}

/**
 * CTF-2: Verify escrow lock conditions via EscrowProvider.
 *
 * Without this, a requester could submit a token locked to their own key
 * instead of the worker's, then redeem after preimage is revealed.
 *
 * Returns `{ ok: true }` when the token passes all checks.
 * A failure returns `{ ok: false, message }`.
 */
export async function verifyEscrowLock(
  escrowProvider: EscrowProvider,
  escrowRef: string,
  paymentHash: string,
  workerPubkey: string,
): Promise<HtlcTokenLockResult> {
  return escrowProvider.verifyLock(escrowRef, paymentHash, workerPubkey);
}

/** Minimum HTLC locktime in seconds (10 minutes). */
export const MIN_HTLC_LOCKTIME_SECS = 600;

// --- Escrow state machine helpers ---

/** Valid state transitions for escrow (HTLC) queries. */
export const HTLC_TRANSITIONS: Record<string, QueryStatus[]> = {
  awaiting_quotes: ["worker_selected"],
  worker_selected: ["processing"],
  processing: ["verifying"],
  verifying: ["approved", "rejected"],
};

export function validateHtlcTransition(from: QueryStatus, to: QueryStatus): boolean {
  return HTLC_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isHtlcQuery(query: Query): boolean {
  return query.htlc !== undefined || query.escrow !== undefined;
}

export interface EscrowAmountResult {
  valid: boolean;
  amountSats?: number;
  error?: string;
}

/**
 * Verify that the escrow carries at least the expected amount.
 * Delegates to EscrowProvider.verify().
 */
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
