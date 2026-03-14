export type QueryStatus =
  | "pending"
  | "submitted"
  | "approved"
  | "rejected"
  | "expired";
export type PaymentStatus = "locked" | "released" | "cancelled";
export type RequesterType = "agent" | "human" | "app";
export type ExecutorType = "human" | "agent" | "service";
export type SubmissionChannel = "worker_api" | "mcp";
export type AttachmentStorageKind = "blossom" | "external";

export interface QueryInput {
  description: string;
  location_hint?: string;
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
}

export interface VerificationDetail {
  passed: boolean;
  checks: string[];
  failures: string[];
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

export interface Query {
  id: string;
  status: QueryStatus;
  description: string;
  location_hint?: string;
  challenge_nonce: string;
  challenge_rule: string;
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
}
