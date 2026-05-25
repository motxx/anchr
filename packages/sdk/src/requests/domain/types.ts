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
export type AttachmentStorageKind = "blossom" | "external";

/** Controls whether TLSNotary proof is published to Nostr relays or kept private. */
export type ProofVisibility = "public" | "customer_only";

export interface GpsCoord {
  lat: number;
  lon: number;
}

/**
 * Verification factors that a Customer can request.
 * When omitted, defaults to ["gps", "ai_check"].
 */
export const VERIFICATION_FACTORS = [
  "nonce",
  "gps",
  "timestamp",
  "oracle",
  "ai_check",
  "tlsn",
] as const;
export type VerificationFactor = (typeof VERIFICATION_FACTORS)[number];

export const DEFAULT_VERIFICATION_FACTORS: readonly VerificationFactor[] = [
  "gps",
  "ai_check",
] as const;

// TLSNotary types live in `../../proofs/mod.ts`. The host shared
// domain re-exports them so existing call sites keep the single import surface.
import type {
  TlsnAttestation,
  TlsnCondition,
  TlsnEncryptedContext,
  TlsnRequirement,
  TlsnVerifiedData,
} from "../../proofs/mod.ts";
export type {
  TlsnAttestation,
  TlsnCondition,
  TlsnEncryptedContext,
  TlsnRequirement,
  TlsnVerifiedData,
};

export interface QueryInput {
  description: string;
  location_hint?: string;
  expected_gps?: GpsCoord;
  /** Max allowed distance from expected_gps in km (default: 50). */
  max_gps_distance_km?: number;
  verification_requirements?: readonly VerificationFactor[];
  tlsn_requirements?: TlsnRequirement;
  /** Proof visibility — required when tlsn_requirements is set. */
  visibility?: ProofVisibility;
}

export interface AttachmentRef {
  id: string;
  uri: string;
  mime_type: string;
  storage_kind: AttachmentStorageKind;
  filename?: string;
  size_bytes?: number;
  /** Blossom-specific: SHA-256 hash of encrypted blob. */
  blossom_hash?: string;
  /** Blossom-specific: server URLs where the blob is stored. */
  blossom_servers?: string[];
}

/** Ephemeral key material for Blossom E2E encryption. Never persisted on the server. */
export interface BlossomKeyMaterial {
  encrypt_key: string; // hex-encoded AES-256-GCM key
  encrypt_iv: string; // hex-encoded AES-256-GCM IV
}

/** Map of attachment ID → key material, used for one-time oracle verification. */
export type BlossomKeyMap = Record<string, BlossomKeyMaterial>;

export interface AttachmentAccess {
  original_url: string;
  preview_url?: string;
  view_url?: string;
  meta_url?: string;
}

export interface AttachmentHandle {
  attachment: AttachmentRef;
  access: AttachmentAccess;
}

export interface QueryResult {
  attachments: AttachmentRef[];
  notes?: string;
  /** GPS coordinates reported by the provider's device at submission time. */
  gps?: GpsCoord;
  /** TLSNotary attestation submitted by the provider. */
  tlsn_attestation?: TlsnAttestation;
  /** TLSNotary browser extension result (results[] from MPC-TLS session). */
  tlsn_extension_result?: unknown;
}

/**
 * Query-independent verification policy. The transport-neutral input to the
 * core verifier. NIP-90 adapters derive this from a signed Query event; a
 * standalone caller builds it directly from authenticated requests.
 */
export interface VerificationRequirement {
  /** Stable identifier — used for integrity-store lookup keyed on the request. */
  id: string;
  factors: readonly VerificationFactor[];
  /** Free-text description of what the proof must establish (used by ai_check). */
  description?: string;
  /** Per-request handwritten challenge string (used by ai_check + nonce factor). */
  challenge_nonce?: string;
  expected_gps?: GpsCoord;
  /** Max allowed distance from expected_gps in km. Defaults to 50 inside the verifier. */
  max_gps_distance_km?: number;
  tlsn_requirements?: TlsnRequirement;
}

/** Query-independent shape of the evidence being verified. */
export interface VerificationInput {
  attachments: AttachmentRef[];
  gps?: GpsCoord;
  tlsn_attestation?: TlsnAttestation;
  tlsn_extension_result?: unknown;
}

export interface VerificationDetail {
  passed: boolean;
  checks: string[];
  failures: string[];
  /** Advisory warnings (e.g., ai_check) — informational, do not gate payment. */
  warnings?: string[];
  /** Cryptographically verified TLSNotary data (populated only for tlsn queries). */
  tlsn_verified?: TlsnVerifiedData;
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

export interface BountyInfo {
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
  /** Requested amount in sats (optional; may match bounty). */
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
 *   - P2PK+FROST (`escrow.type === "p2pk_frost"`): `frost_signature` (BIP-340 hex)
 * Exactly one of `preimage` / `frost_signature` is set on a successful
 * outcome; neither is set on rejection or expiry.
 *
 * **FROST message format (settlement contract):** the FROST signature is over
 * the UTF-8 bytes of `anchr/query-settle/v1:${query.id}:approved`. Any
 * downstream redeemer that validates the signature against the P2PK lock
 * **must** use the same prefix and version. See `query-service-methods.ts`
 * `doSubmitEscrowResult` for the canonical encoding.
 */
export interface EscrowSubmitOutcome {
  ok: boolean;
  query: Query | null;
  message: string;
  /** Preimage revealed on HTLC verification success (Provider redeems the HTLC token with this). */
  preimage?: string;
  /** Aggregated FROST Schnorr signature delivered on P2PK+FROST verification success. */
  frost_signature?: string;
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
  tlsn_verified?: TlsnVerifiedData;
}

export interface Query {
  id: string;
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
  bounty?: BountyInfo;
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
  /** Expected GPS coordinates for proximity check. */
  expected_gps?: GpsCoord;
  /** Max allowed distance from expected_gps in km (default: 50). */
  max_gps_distance_km?: number;
  /** TLSNotary requirements for web content verification. */
  tlsn_requirements?: TlsnRequirement;
  /** Multi-oracle quorum config (if set, multiple oracles verify independently). */
  quorum?: QuorumConfig;
  /** Individual oracle attestations collected during quorum verification. */
  attestations?: OracleAttestationRecord[];
  /** Proof visibility — controls whether TLSNotary proof is published to relays. */
  visibility?: ProofVisibility;
  /** Nostr event IDs of published attestation events. */
  published_proofs?: string[];
}
