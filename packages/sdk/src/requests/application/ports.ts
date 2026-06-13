/**
 * Application-layer ports — every external capability the use cases
 * depend on, collected in one place. Adapters live in
 * `src/infrastructure/`; tests inject in-memory fakes.
 *
 * Domain-purity ports (Clock, IdGenerator, NonceGenerator) live in
 * `src/domain/ports.ts` because they're consumed inside the aggregate.
 */

import type { Oracle, OracleInfo } from "../domain/oracle-types.ts";
import type { BlossomKeyMap } from "../../values.ts";
import type {
  OracleAttestationRecord,
  ProofVisibility,
  Query,
  QueryResult,
} from "../domain/types.ts";

// ── HTLC preimage release material ────────────────────────────────

export interface PreimageEntry {
  hash: string;
  preimage: string;
  created_at: number;
}

/**
 * Storage abstraction for the HTLC preimage/hash lifecycle. The Oracle
 * creates a preimage, embeds its hash in the escrow lock, and reveals the
 * preimage on a passing verification so the Provider can redeem.
 */
export interface PreimageStore {
  /** Generate a new preimage/hash pair. Returns the entry (hash is the key). */
  create(): Promise<PreimageEntry>;
  /** Retrieve the preimage by hash (Oracle-only). */
  getPreimage(hash: string): Promise<string | null>;
  /** Check if a hash exists in the store. */
  has(hash: string): Promise<boolean>;
  /** Verify a preimage matches the stored hash. */
  verify(hash: string, preimage: string): Promise<boolean>;
  /** Delete the entry (after delivery or expiry). */
  delete(hash: string): Promise<void>;
}

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
 * escrow type is `p2pk_frost`. The implementing adapter re-derives the
 * signing message from the query and forwards the verification
 * requirement/evidence so each peer signer can re-check independently
 * before contributing a share.
 *
 * Returns aggregated signatures as hex strings on success.
 * Returns `null` when the threshold cannot be met, the coordinator is
 * unreachable, or signing was rejected — callers must treat `null` as
 * "settlement not available, do not include in the response."
 */
export interface FrostSignaturePort {
  requestSignature(
    query: Query,
    result: QueryResult,
    blossomKeys?: BlossomKeyMap,
  ): Promise<string[] | null>;
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
