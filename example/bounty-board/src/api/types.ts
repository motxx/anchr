/** Shared types mirrored from backend src/types.ts */

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

export interface GpsCoord {
  lat: number;
  lon: number;
}

export interface AttachmentRef {
  id: string;
  uri: string;
  mime_type: string;
  storage_kind: "blossom" | "external";
  filename?: string;
  size_bytes?: number;
  blossom_hash?: string;
  blossom_servers?: string[];
}

export interface BlossomKeyMaterial {
  encrypt_key: string;
  encrypt_iv: string;
}

export type BlossomKeyMap = Record<string, BlossomKeyMaterial>;

export interface BountyInfo {
  amount_sats: number;
}

export interface HtlcSummary {
  hash: string;
  oracle_pubkey: string;
  worker_pubkey: string | null;
  locktime: number;
}

export interface VerificationDetail {
  passed: boolean;
  checks: string[];
  failures: string[];
  tlsn_verified?: TlsnVerifiedData;
}

export type VerificationFactor = "nonce" | "gps" | "timestamp" | "oracle" | "ai_check" | "tlsn";

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
  max_attestation_age_seconds?: number;
}

export interface TlsnAttestation {
  presentation: string;
}

export interface TlsnVerifiedData {
  server_name: string;
  revealed_body: string;
  revealed_headers?: string;
  session_timestamp: number;
}

export interface QuerySummary {
  id: string;
  status: QueryStatus;
  description: string;
  location_hint: string | null;
  bounty: BountyInfo | null;
  challenge_nonce: string | null;
  challenge_rule: string | null;
  verification_requirements: VerificationFactor[];
  oracle_ids: string[] | null;
  expires_at: number;
  expires_in_seconds: number;
  htlc: HtlcSummary | null;
  quotes_count: number;
  expected_gps: GpsCoord | null;
  tlsn_requirements: TlsnRequirement | null;
}

export interface QueryDetail extends QuerySummary {
  created_at: number;
  submitted_at: number | null;
  assigned_oracle_id: string | null;
  result?: {
    attachments: AttachmentRef[];
    notes?: string;
    tlsn_attestation?: TlsnAttestation;
    tlsn_verified?: TlsnVerifiedData;
  };
  verification?: VerificationDetail;
  payment_status: PaymentStatus;
  blossom_keys: BlossomKeyMap | null;
  tlsn_verifier_url?: string | null;
  tlsn_proxy_url?: string | null;
}

export interface UploadResponse {
  ok: boolean;
  attachment?: AttachmentRef;
  encryption?: BlossomKeyMaterial;
  error?: string;
}

export interface SubmitResponse {
  ok: boolean;
  message: string;
  verification?: VerificationDetail;
  oracle_id?: string | null;
  payment_status?: PaymentStatus;
  bounty_amount_sats?: number | null;
  cashu_token?: string | null;
}

export interface CreateQueryRequest {
  description: string;
  type: "photo" | "web";
  location_hint?: string;
  expected_gps?: GpsCoord;
  gps_max_distance_km?: number;
  bounty_amount_sats?: number;
  ttl_seconds?: number;
  verification_requirements?: VerificationFactor[];
  tlsn_requirements?: TlsnRequirement;
}

export interface QuoteInfo {
  worker_pubkey: string;
  amount_sats?: number;
  timestamp: number;
}
