import type { EscrowProvider } from "./escrow-port.ts";
import type { Query, QueryStatus } from "../domain/types.ts";

export interface EscrowTokenLockResult {
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
): Promise<EscrowTokenLockResult> {
  return escrowProvider.verifyLock(escrowRef, paymentHash, workerPubkey);
}

// MIN_ESCROW_LOCKTIME_SECS is defined in domain/value-objects.ts. Re-export for the
// callers that import it via the application layer.
export { MIN_ESCROW_LOCKTIME_SECS } from "../domain/value-objects.ts";

// --- Escrow state machine helpers ---

/** Valid state transitions for escrow queries (HTLC and P2PK+FROST share this lifecycle). */
export const ESCROW_TRANSITIONS: Record<string, QueryStatus[]> = {
  awaiting_quotes: ["worker_selected"],
  worker_selected: ["processing"],
  processing: ["verifying"],
  verifying: ["approved", "rejected"],
};

export function validateEscrowTransition(from: QueryStatus, to: QueryStatus): boolean {
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
