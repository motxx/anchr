/**
 * Application-layer ports — every external capability the use cases
 * depend on, collected in one place. Adapters live in
 * `src/infrastructure/`; tests inject in-memory fakes.
 *
 * Domain-purity ports (Clock, IdGenerator, NonceGenerator) live in
 * `src/domain/ports.ts` because they're consumed inside the aggregate.
 */

import type { Oracle, OracleInfo } from "../domain/oracle-types.ts";
import type {
  OracleAttestationRecord,
  ProofVisibility,
  Query,
} from "../domain/types.ts";

// ── Cashu / FROST escrow ──────────────────────────────────────────

export interface EscrowProvider {
  createHold(params: {
    amount_sats: number;
    payment_hash: string;
    expiry: number;
    customer_pubkey: string;
  }): Promise<{ escrow_ref: string } | null>;

  bindProvider(
    escrow_ref: string,
    provider_pubkey: string,
  ): Promise<{ escrow_ref: string } | null>;

  verify(
    escrow_ref: string,
    expected_sats: number,
  ): Promise<{ valid: boolean; amount_sats?: number; error?: string }>;

  verifyLock(
    escrow_ref: string,
    payment_hash: string,
    provider_pubkey: string,
  ): Promise<{ ok: boolean; message?: string }>;

  settle(
    escrow_ref: string,
    preimage: string,
  ): Promise<{ settled: boolean; error?: string }>;

  cancel(
    escrow_ref: string,
  ): Promise<{ cancelled: boolean; error?: string }>;
}

// ── Oracle registry ───────────────────────────────────────────────

export interface OracleRegistry {
  get(id: string): Oracle | null;
  list(): OracleInfo[];
  register(oracle: Oracle): void;
  resolve(
    oracleId: string | undefined,
    acceptableIds: string[] | undefined,
  ): Oracle | null;
  resolveMultiple(acceptableIds: string[] | undefined, count: number): Oracle[];
}

// ── FROST threshold-signature coordinator ─────────────────────────

/**
 * Application-layer port for requesting a t-of-n threshold Schnorr
 * signature from a FROST Oracle group.
 *
 * Used by the Query lifecycle when an escrow query is approved and the
 * escrow type is `p2pk_frost`. The port abstracts the round-1 / round-2
 * FROST coordinator handshake so the application layer doesn't pull in
 * `../../payments/mod.ts` directly.
 *
 * Returns the aggregated signature as a hex string on success.
 * Returns `null` when the threshold cannot be met, the coordinator is
 * unreachable, or signing was rejected — callers must treat `null` as
 * "settlement not available, do not include in the response."
 */
export interface FrostSignaturePort {
  requestSignature(
    groupPubkey: string,
    message: Uint8Array,
  ): Promise<string | null>;
}

// ── Proof delivery (Nostr publish or customer-only DM) ───────────

export interface ProofPublishResult {
  event_id: string;
  relays: string[];
}

export interface ProofDelivery {
  /**
   * Returns null if visibility is "customer_only" or if publishing is skipped.
   */
  publish(
    query: Query,
    attestation: OracleAttestationRecord,
    visibility: ProofVisibility,
  ): Promise<ProofPublishResult | null>;
}
