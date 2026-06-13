import type {
  AttachmentRef,
  BlossomKeyMap,
  VerificationFactor,
} from "../../values.ts";
import type { VerificationDetail } from "../../proofs/mod.ts";
import type { SchemaUri } from "../../schema.ts";

export type QueryStatus =
  | "pending"
  | "awaiting_offers"
  | "provider_selected"
  | "processing"
  | "verifying"
  | "submitted"
  | "approved"
  | "rejected"
  | "expired";
export type PaymentStatus =
  | "none"
  | "escrow_pending"
  | "escrow_locked"
  | "escrow_swapped"
  | "locked"
  | "released"
  | "cancelled";
export type CustomerType = "agent" | "human" | "app";
export type ExecutorType = "human" | "agent" | "service";
export type SubmissionChannel = "adapter";

/** Controls whether proof details are published to Nostr relays or kept private. */
export type ProofVisibility = "public" | "customer_only";

export interface QueryInput {
  description: string;
  schema?: SchemaUri;
  location_hint?: string;
  verification_requirements?: readonly VerificationFactor[];
  schema_requirement?: unknown;
  /** Proof visibility controls whether schema verdict details are published. */
  visibility?: ProofVisibility;
}

export interface QueryResult {
  attachments: AttachmentRef[];
  notes?: string;
  schema_evidence?: unknown;
}

export interface CustomerMeta {
  customer_type: CustomerType;
  customer_id?: string;
  client_name?: string;
}

export interface SubmissionMeta {
  executor_type: ExecutorType;
  channel: SubmissionChannel;
}

export interface PaymentLockInfo {
  amount_sats: number;
  escrow_token?: string;
}

/** Escrow mechanism type — discriminator for the EscrowInfo union. */
export type EscrowType = "htlc" | "p2pk_frost";

/** Fields shared by every escrow variant. */
interface EscrowCommonFields {
  /** Oracle pubkeys (singleton for HTLC, FROST signers for threshold). */
  oracle_pubkeys: string[];
  /** Customer's Nostr pubkey (hex) — used for refund. */
  customer_pubkey: string;
  /** Provider's Nostr pubkey (hex) — set after provider selection. */
  provider_pubkey?: string;
  /** Locktime as unix timestamp (seconds). */
  locktime: number;
  /** Encoded escrow token (held by Customer until swap). */
  escrow_token?: string;
  /** Server-verified escrow amount in sats. */
  verified_escrow_sats?: number;
  /** Opaque reference for EscrowProvider tracking. */
  escrow_ref?: string;
}

/**
 * NUT-14 hashlocked timelock contract — Oracle reveals a preimage to settle.
 * The escrow token is locked to `provider_pubkey` AND the hash; both must be
 * satisfied to redeem.
 */
export interface HtlcEscrow extends EscrowCommonFields {
  type: "htlc";
  /** SHA-256 hash of the preimage Oracle reveals on a passing verification. */
  hash: string;
}

/**
 * NUT-11 pay-to-pubkey escrow signed by a FROST t-of-n Oracle group.
 * Settlement is a threshold Schnorr signature instead of a preimage reveal.
 * See `../../payments/mod.ts` for the signing flow.
 */
export interface P2pkFrostEscrow extends EscrowCommonFields {
  type: "p2pk_frost";
  /** BIP-340 x-only FROST group public key (the t-of-n threshold key). */
  group_pubkey: string;
}

/** Escrow information for an in-flight Query. Discriminated by `type`. */
export type EscrowInfo = HtlcEscrow | P2pkFrostEscrow;

/** An offer from a Provider offering to fulfill a query. */
export interface OfferInfo {
  /** Provider's Nostr pubkey (hex). */
  provider_pubkey: string;
  /** Requested amount in sats (optional; may match the Payment Lock amount). */
  amount_sats?: number;
  /** Nostr event ID of the kind 7000 offer event. */
  offer_event_id: string;
  /** Timestamp when the offer was received. */
  received_at: number;
}

/**
 * Outcome of submitEscrowResult. On verification success the provider receives
 * a settlement artifact whose shape depends on the escrow type:
 *   - HTLC (`escrow.type === "htlc"`):       `preimage` (SHA-256 preimage hex)
 *   - P2PK+FROST (`escrow.type === "p2pk_frost"`): `frost_signature` (BIP-340 hex per proof)
 * Exactly one of `preimage` / `frost_signature` is set on a successful
 * outcome; neither is set on rejection or expiry.
 */
export interface EscrowSubmitOutcome {
  ok: boolean;
  query: Query | null;
  message: string;
  /** Preimage revealed on HTLC verification success (Provider redeems the HTLC token with this). */
  preimage?: string;
  /** Aggregated FROST Schnorr signatures delivered on P2PK+FROST verification success. */
  frost_signature?: string[];
}

export interface QuorumConfig {
  /** Minimum number of oracle approvals required. */
  min_approvals: number;
}

/** Individual oracle attestation stored for quorum tracking. */
export interface OracleAttestationRecord {
  oracle_id: string;
  passed: boolean;
  checks: string[];
  failures: string[];
  attested_at: number;
  schema_verdict?: unknown;
}

export interface Query {
  id: string;
  schema?: SchemaUri;
  status: QueryStatus;
  description: string;
  location_hint?: string;
  challenge_nonce?: string;
  challenge_rule?: string;
  /** Verification factors requested by the Customer. */
  verification_requirements: readonly VerificationFactor[];
  created_at: number;
  expires_at: number;
  customer_meta?: CustomerMeta;
  payment_lock?: PaymentLockInfo;
  /** Acceptable oracle IDs set by customer. Empty/undefined = any (defaults to built-in). */
  oracle_ids?: string[];
  /** Oracle selected by provider at submission time. */
  assigned_oracle_id?: string;
  submitted_at?: number;
  result?: QueryResult;
  verification?: VerificationDetail;
  submission_meta?: SubmissionMeta;
  payment_status: PaymentStatus;
  /** Escrow details (present when payment escrow is used). */
  escrow?: EscrowInfo;
  /** Provider offers received for this query. */
  offers?: OfferInfo[];
  /** Nostr event ID of the kind 5300 Job Request. */
  nostr_event_id?: string;
  /** Ephemeral Blossom encryption keys — stored for customer download via HTTP API. */
  blossom_keys?: BlossomKeyMap;
  schema_requirement?: unknown;
  /** Multi-oracle quorum config (if set, multiple oracles verify independently). */
  quorum?: QuorumConfig;
  /** Individual oracle attestations collected during quorum verification. */
  attestations?: OracleAttestationRecord[];
  /** Proof visibility controls whether schema verdict details are published. */
  visibility?: ProofVisibility;
  /** Nostr event IDs of published attestation events. */
  published_proofs?: string[];
}
