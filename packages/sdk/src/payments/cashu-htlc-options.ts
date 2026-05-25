import { P2PKBuilder, type P2PKOptions } from "@cashu/cashu-ts";

/** Parameters for Phase 1: Initial lock before Provider selection. */
export interface HtlcInitialLockParams {
  /** SHA-256 hash of preimage. */
  hash: string;
  /** Customer's public key for refund (hex). */
  customerPubkey: string;
  /** Locktime as unix timestamp (seconds). */
  locktimeSeconds: number;
}

/** Parameters for Phase 1 when preselection proofs are visible to other actors. */
export interface HtlcPreselectionLockParams {
  /**
   * Customer's public key (hex). Spending or swapping the preselection proofs
   * requires the Customer's signature.
   */
  customerPubkey: string;
}

/** Parameters for Phase 2: HTLC swap to bind a selected Provider. */
export interface HtlcProviderBindParams {
  /** SHA-256 hash of preimage. */
  hash: string;
  /** Provider's public key (hex) — spending requires Provider signature + preimage. */
  providerPubkey: string;
  /** Customer's public key for timeout refund (hex). */
  customerRefundPubkey: string;
  /** Locktime as unix timestamp (seconds). */
  locktimeSeconds: number;
}

/**
 * Build P2PK options for Phase 1: Hold token before Provider is known.
 *
 * Returns null for local-hold mode. The Customer holds plain proofs locally
 * and does not publish or transfer them before Provider selection. No P2PK or
 * hashlock is applied because:
 *   - Adding hashlock would require preimage to swap (Customer doesn't have it)
 *
 * The "escrow" aspect comes only in Phase 2 when HTLC conditions are applied.
 */
export function buildHtlcInitialOptions(params: HtlcInitialLockParams): null {
  // Phase 1: no conditions — plain proofs held locally by Customer.
  // params.hash is retained for Phase 2 but not used here.
  return null;
}

/**
 * Build P2PK options for Phase 1 when the preselection token or proofs are
 * visible outside the Customer's process before a Provider is selected.
 *
 * This is not the final HTLC. It deliberately omits the hashlock because the
 * Customer still needs to swap these proofs in Phase 2 before the Oracle
 * releases the preimage. P2PK(Customer) prevents relay observers or other
 * unselected actors from spending the visible proofs as bearer instruments.
 */
export function buildHtlcPreselectionOptions(
  params: HtlcPreselectionLockParams,
): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey(params.customerPubkey)
    .requireLockSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Build P2PK options for Phase 2: HTLC with Provider bound.
 *
 * hashlock(hash) + P2PK(Provider) + locktime + refund(Customer).
 * Provider redeems with preimage + Provider signature.
 */
export function buildHtlcFinalOptions(
  params: HtlcProviderBindParams,
): P2PKOptions {
  return new P2PKBuilder()
    .addHashlock(params.hash)
    .addLockPubkey(params.providerPubkey)
    .requireLockSignatures(1)
    .lockUntil(params.locktimeSeconds)
    .addRefundPubkey(params.customerRefundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}
