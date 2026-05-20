import { P2PKBuilder, type P2PKOptions } from "@cashu/cashu-ts";

/** Parameters for Phase 1: Initial lock before Worker selection. */
export interface HtlcInitialLockParams {
  /** SHA-256 hash of preimage. */
  hash: string;
  /** Requester's public key for refund (hex). */
  requesterPubkey: string;
  /** Locktime as unix timestamp (seconds). */
  locktimeSeconds: number;
}

/** Parameters for Phase 1 when preselection proofs are visible to other actors. */
export interface HtlcPreselectionLockParams {
  /**
   * Requester's public key (hex). Spending or swapping the preselection proofs
   * requires the Requester's signature.
   */
  requesterPubkey: string;
}

/** Parameters for Phase 2: HTLC swap to bind a selected Worker. */
export interface HtlcWorkerBindParams {
  /** SHA-256 hash of preimage. */
  hash: string;
  /** Worker's public key (hex) — spending requires Worker signature + preimage. */
  workerPubkey: string;
  /** Requester's public key for timeout refund (hex). */
  requesterRefundPubkey: string;
  /** Locktime as unix timestamp (seconds). */
  locktimeSeconds: number;
}

/**
 * Build P2PK options for Phase 1: Hold token before Worker is known.
 *
 * Returns null for local-hold mode. The Requester holds plain proofs locally
 * and does not publish or transfer them before Worker selection. No P2PK or
 * hashlock is applied because:
 *   - Adding hashlock would require preimage to swap (Requester doesn't have it)
 *
 * The "escrow" aspect comes only in Phase 2 when HTLC conditions are applied.
 */
export function buildHtlcInitialOptions(params: HtlcInitialLockParams): null {
  // Phase 1: no conditions — plain proofs held locally by Requester.
  // params.hash is retained for Phase 2 but not used here.
  return null;
}

/**
 * Build P2PK options for Phase 1 when the preselection token or proofs are
 * visible outside the Requester's process before a Worker is selected.
 *
 * This is not the final HTLC. It deliberately omits the hashlock because the
 * Requester still needs to swap these proofs in Phase 2 before the Oracle
 * releases the preimage. P2PK(Requester) prevents relay observers or other
 * unselected actors from spending the visible proofs as bearer instruments.
 */
export function buildHtlcPreselectionOptions(
  params: HtlcPreselectionLockParams,
): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey(params.requesterPubkey)
    .requireLockSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Build P2PK options for Phase 2: HTLC with Worker bound.
 *
 * hashlock(hash) + P2PK(Worker) + locktime + refund(Requester).
 * Worker redeems with preimage + Worker signature.
 */
export function buildHtlcFinalOptions(
  params: HtlcWorkerBindParams,
): P2PKOptions {
  return new P2PKBuilder()
    .addHashlock(params.hash)
    .addLockPubkey(params.workerPubkey)
    .requireLockSignatures(1)
    .lockUntil(params.locktimeSeconds)
    .addRefundPubkey(params.requesterRefundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}
