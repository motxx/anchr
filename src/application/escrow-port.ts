export interface EscrowProvider {
  createHold(params: {
    amount_sats: number;
    payment_hash: string;
    expiry: number;
    requester_pubkey: string;
  }): Promise<{ escrow_ref: string } | null>;

  bindWorker(
    escrow_ref: string,
    worker_pubkey: string,
  ): Promise<{ escrow_ref: string } | null>;

  verify(
    escrow_ref: string,
    expected_sats: number,
  ): Promise<{ valid: boolean; amount_sats?: number; error?: string }>;

  verifyLock(
    escrow_ref: string,
    payment_hash: string,
    worker_pubkey: string,
  ): Promise<{ ok: boolean; message?: string }>;

  settle(
    escrow_ref: string,
    preimage: string,
  ): Promise<{ settled: boolean; error?: string }>;

  cancel(
    escrow_ref: string,
  ): Promise<{ cancelled: boolean; error?: string }>;
}
