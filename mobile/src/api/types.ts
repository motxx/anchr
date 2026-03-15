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
}

export type VerificationFactor = "nonce" | "gps" | "timestamp" | "oracle" | "ai_check";

/** Shape returned by GET /queries (querySummary presenter) */
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
}

/** Shape returned by GET /queries/:id (queryDetail presenter) */
export interface QueryDetail extends QuerySummary {
  created_at: number;
  submitted_at: number | null;
  assigned_oracle_id: string | null;
  result?: {
    attachments: AttachmentRef[];
    notes?: string;
  };
  verification?: VerificationDetail;
  payment_status: PaymentStatus;
  blossom_keys: BlossomKeyMap | null;
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
}
