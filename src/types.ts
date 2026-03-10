export type QueryType = "photo_proof" | "store_status" | "webpage_field";
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
export type AttachmentStorageKind = "local" | "external" | "s3" | "blossom";

export interface PhotoProofParams {
  target: string; // e.g. "コンビニ入口の営業時間表示"
  location_hint?: string;
}

export interface StoreStatusParams {
  store_name: string;
  location_hint?: string;
}

export interface WebpageFieldParams {
  url: string;
  field: string; // e.g. "税込価格"
  anchor_word: string; // word whose nearby text serves as proof
}

export type QueryInput =
  | ({ type: "photo_proof" } & PhotoProofParams)
  | ({ type: "store_status" } & StoreStatusParams)
  | ({ type: "webpage_field" } & WebpageFieldParams);

export interface AttachmentRef {
  id: string;
  uri: string;
  mime_type: string;
  storage_kind: AttachmentStorageKind;
  filename?: string;
  size_bytes?: number;
  local_file_path?: string;
  route_path?: string;
  /** Blossom-specific: SHA-256 hash of encrypted blob. */
  blossom_hash?: string;
  /** Blossom-specific: hex-encoded AES-256-GCM decryption key. */
  blossom_encrypt_key?: string;
  /** Blossom-specific: hex-encoded AES-256-GCM IV. */
  blossom_encrypt_iv?: string;
  /** Blossom-specific: server URLs where the blob is stored. */
  blossom_servers?: string[];
}

export interface AttachmentAccess {
  original_url: string;
  preview_url?: string;
  view_url?: string;
  meta_url?: string;
  local_file_path?: string;
}

export interface AttachmentHandle {
  attachment: AttachmentRef;
  access: AttachmentAccess;
}

export interface PhotoProofResult {
  text_answer?: string;
  attachments: AttachmentRef[];
  notes?: string;
}

export interface StoreStatusResult {
  status: "open" | "closed";
  text_answer?: string; // should contain nonce (handwritten in photo)
  attachments?: AttachmentRef[]; // photo evidence of store
  notes?: string;
}

export interface WebpageFieldResult {
  answer: string; // extracted value
  proof_text: string; // text near anchor_word from page
  notes?: string;
}

export type QueryResult =
  | ({ type: "photo_proof" } & PhotoProofResult)
  | ({ type: "store_status" } & StoreStatusResult)
  | ({ type: "webpage_field" } & WebpageFieldResult);

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
  type: QueryType;
  status: QueryStatus;
  params: QueryInput;
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
