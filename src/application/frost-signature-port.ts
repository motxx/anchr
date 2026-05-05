/**
 * FrostSignaturePort — application-layer port for requesting a t-of-n
 * threshold Schnorr signature from a FROST Oracle group.
 *
 * Used by the Query lifecycle when an escrow query is approved and the
 * escrow type is `p2pk_frost`. The port abstracts the round-1 / round-2
 * FROST coordinator handshake so the application layer doesn't pull in
 * `packages/frost-oracle` directly.
 *
 * The reference adapter that wires this port to the actual FROST
 * coordinator lives in `src/infrastructure/frost/`. Tests inject a mock.
 */
export interface FrostSignaturePort {
  /**
   * Request an aggregated FROST Schnorr signature on `message` from the
   * threshold group identified by `groupPubkey` (BIP-340 x-only hex).
   *
   * Returns the aggregated signature as a hex string on success.
   * Returns `null` when the threshold cannot be met, the coordinator is
   * unreachable, or signing was rejected — callers must treat `null` as
   * "settlement not available, do not include in the response."
   */
  requestSignature(
    groupPubkey: string,
    message: Uint8Array,
  ): Promise<string | null>;
}
