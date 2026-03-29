export type QueryStatus =
  | "pending"
  | "awaiting_quotes"
  | "worker_selected"
  | "processing"
  | "verifying"
  | "submitted"
  | "approved"
  | "rejected"
  | "expired";
export type PaymentStatus =
  | "none"
  | "htlc_pending"
  | "htlc_locked"
  | "htlc_swapped"
  | "locked"
  | "released"
  | "cancelled";
export type RequesterType = "agent" | "human" | "app";
export type ExecutorType = "human" | "agent" | "service";
export type SubmissionChannel = "worker_api" | "mcp";
export type AttachmentStorageKind = "blossom" | "external";

export interface GpsCoord {
  lat: number;
  lon: number;
}

/**
 * Verification factors that a Requester can request.
 * When omitted, defaults to ["gps", "ai_check"].
 */
export const VERIFICATION_FACTORS = ["nonce", "gps", "timestamp", "oracle", "ai_check", "tlsn"] as const;
export type VerificationFactor = (typeof VERIFICATION_FACTORS)[number];

export const DEFAULT_VERIFICATION_FACTORS: readonly VerificationFactor[] = ["gps", "ai_check"] as const;

export interface TlsnCondition {
  type: "contains" | "regex" | "jsonpath";
  expression: string;
  expected?: string;
  description?: string;
}

export interface TlsnRequirement {
  target_url: string;
  method?: "GET" | "POST";
  conditions?: TlsnCondition[];
  /** Max age of attestation in seconds (default: 300). */
  max_attestation_age_seconds?: number;
  /** Domain hint for public display when actual URL is delivered via encrypted_context. */
  domain_hint?: string;
}

/** Sensitive context encrypted to Worker — never stored publicly. */
export interface TlsnEncryptedContext {
  /** The actual target URL (may contain session IDs). */
  target_url: string;
  /** Custom HTTP headers (e.g., Authorization). */
  headers?: Record<string, string>;
  /** HTTP method override (default: GET). */
  method?: "GET" | "POST";
  /** Request body for POST requests. */
  body?: string;
}

export interface TlsnAttestation {
  /** Base64-encoded TLSNotary presentation file (.presentation.tlsn). */
  presentation: string;
}

/** Cryptographically verified data extracted from a TLSNotary presentation by the oracle. */
export interface TlsnVerifiedData {
  server_name: string;
  revealed_body: string;
  revealed_headers?: string;
  /** Session timestamp (unix seconds, from the cryptographic proof). */
  session_timestamp: number;
}

export interface QueryInput {
  description: string;
  location_hint?: string;
  expected_gps?: GpsCoord;
  /** Max allowed distance from expected_gps in km (default: 50). */
  max_gps_distance_km?: number;
  verification_requirements?: readonly VerificationFactor[];
  tlsn_requirements?: TlsnRequirement;
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
  encrypt_iv: string;  // hex-encoded AES-256-GCM IV
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
  /** GPS coordinates reported by the worker's device at submission time. */
  gps?: GpsCoord;
  /** TLSNotary attestation submitted by the worker. */
  tlsn_attestation?: TlsnAttestation;
  /** TLSNotary browser extension result (results[] from MPC-TLS session). */
  tlsn_extension_result?: unknown;
}

export interface VerificationDetail {
  passed: boolean;
  checks: string[];
  failures: string[];
  /** Cryptographically verified TLSNotary data (populated only for tlsn queries). */
  tlsn_verified?: TlsnVerifiedData;
}

export interface RequesterMeta {
  requester_type: RequesterType;
  requester_id?: string;
  client_name?: string;
}

export interface SubmissionMeta {
  executor_type: ExecutorType;
  channel: SubmissionChannel;
}

export interface BountyInfo {
  amount_sats: number;
  cashu_token?: string;
}

/** HTLC escrow information for trustless payment. */
export interface HtlcInfo {
  /** SHA-256 hash of the preimage — known to all parties. */
  hash: string;
  /** Oracle's Nostr pubkey (hex). */
  oracle_pubkey: string;
  /** Requester's Nostr pubkey (hex) — used for HTLC refund. */
  requester_pubkey: string;
  /** Worker's Nostr pubkey (hex) — set after worker selection. */
  worker_pubkey?: string;
  /** HTLC locktime as unix timestamp (seconds). */
  locktime: number;
  /** Encoded Cashu HTLC token (held by Requester until swap). */
  escrow_token?: string;
}

/** A quote from a Worker offering to fulfill a query. */
export interface QuoteInfo {
  /** Worker's Nostr pubkey (hex). */
  worker_pubkey: string;
  /** Requested amount in sats (optional; may match bounty). */
  amount_sats?: number;
  /** Nostr event ID of the kind 7000 quote event. */
  quote_event_id: string;
  /** Timestamp when the quote was received. */
  received_at: number;
}

/** Outcome of submitHtlcResult — includes preimage on success. */
export interface HtlcSubmitOutcome {
  ok: boolean;
  query: Query | null;
  message: string;
  /** Preimage revealed on verification success (Worker uses this to redeem HTLC token). */
  preimage?: string;
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
  /** Verification factors requested by the Requester. */
  verification_requirements: readonly VerificationFactor[];
  created_at: number;
  expires_at: number;
  requester_meta?: RequesterMeta;
  bounty?: BountyInfo;
  /** Acceptable oracle IDs set by requester. Empty/undefined = any (defaults to built-in). */
  oracle_ids?: string[];
  /** Oracle selected by worker at submission time. */
  assigned_oracle_id?: string;
  submitted_at?: number;
  result?: QueryResult;
  verification?: VerificationDetail;
  submission_meta?: SubmissionMeta;
  payment_status: PaymentStatus;
  /** HTLC escrow details (present when Cashu payment is used). */
  htlc?: HtlcInfo;
  /** Worker quotes received for this query. */
  quotes?: QuoteInfo[];
  /** Nostr event ID of the kind 5300 Job Request. */
  nostr_event_id?: string;
  /** Ephemeral Blossom encryption keys — stored for requester download via HTTP API. */
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
}
