/**
 * EscrowProvider — abstract escrow port (application layer).
 *
 * Decouples domain/application logic from any specific escrow mechanism.
 * Currently backed by Cashu HTLC; designed for future PTLC/DLC swap.
 */

export interface EscrowProvider {
  /** Create an initial hold (Phase 1). Returns an opaque reference or null on failure. */
  createHold(params: {
    amount_sats: number;
    payment_hash: string;
    expiry: number;
    requester_pubkey: string;
  }): Promise<{ escrow_ref: string } | null>;

  /** Bind a Worker to an existing escrow (Phase 2 swap). */
  bindWorker(
    escrow_ref: string,
    worker_pubkey: string,
  ): Promise<{ escrow_ref: string } | null>;

  /** Verify that escrow carries the expected amount. */
  verify(
    escrow_ref: string,
    expected_sats: number,
  ): Promise<{ valid: boolean; amount_sats?: number; error?: string }>;

  /** Verify HTLC lock conditions (hashlock + P2PK). */
  verifyLock(
    escrow_ref: string,
    payment_hash: string,
    worker_pubkey: string,
  ): Promise<{ ok: boolean; message?: string }>;

  /** Settle the escrow with the preimage (Worker redeem). */
  settle(
    escrow_ref: string,
    preimage: string,
  ): Promise<{ settled: boolean; error?: string }>;

  /** Cancel / refund the escrow. */
  cancel(
    escrow_ref: string,
  ): Promise<{ cancelled: boolean; error?: string }>;
}
