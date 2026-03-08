export type JobType = "photo_proof" | "store_status" | "webpage_field";
export type JobStatus =
  | "pending"
  | "submitted"
  | "approved"
  | "rejected"
  | "expired";
export type PaymentStatus = "locked" | "released" | "cancelled";

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

export type JobParams =
  | ({ type: "photo_proof" } & PhotoProofParams)
  | ({ type: "store_status" } & StoreStatusParams)
  | ({ type: "webpage_field" } & WebpageFieldParams);

export interface PhotoProofResult {
  text_answer: string; // must contain nonce
  attachments?: string[]; // URLs of uploaded photos
  notes?: string;
}

export interface StoreStatusResult {
  status: "open" | "closed";
  notes: string; // must contain nonce
}

export interface WebpageFieldResult {
  answer: string; // extracted value
  proof_text: string; // text near anchor_word from page
  notes?: string;
}

export type JobResult =
  | ({ type: "photo_proof" } & PhotoProofResult)
  | ({ type: "store_status" } & StoreStatusResult)
  | ({ type: "webpage_field" } & WebpageFieldResult);

export interface VerificationDetail {
  passed: boolean;
  checks: string[];
  failures: string[];
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  params: JobParams;
  challenge_nonce: string;
  challenge_rule: string;
  created_at: number;
  expires_at: number;
  submitted_at?: number;
  result?: JobResult;
  verification?: VerificationDetail;
  payment_status: PaymentStatus;
}
