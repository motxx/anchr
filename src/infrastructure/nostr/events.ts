/**
 * Anchr Nostr event builders and parsers.
 *
 * Uses NIP-90 Data Vending Machine (DVM) event kinds so that any
 * DVM-aware client can discover and interact with Anchr queries.
 *
 * Event kind mapping:
 *   ANCHR_QUERY_REQUEST   = 5300  (DVM Job Request)
 *   ANCHR_QUERY_RESPONSE  = 6300  (DVM Job Result)
 *   ANCHR_QUERY_FEEDBACK  = 7000  (DVM Job Feedback — quotes, selection, completion)
 *
 * Kind 7000 is used for multiple sub-types per NIP-90:
 *   status=payment-required  → Worker quote
 *   status=processing        → Worker selection announcement
 *   status=success/error     → Completion feedback
 */

import type { TlsnEncryptedContext, VerificationFactor } from "../../domain/types";
import { deriveConversationKey, decryptNip44 } from "./encryption";

// NIP-90 DVM event kinds for Anchr.
export const ANCHR_QUERY_REQUEST = 5300;   // DVM Job Request
export const ANCHR_QUERY_RESPONSE = 6300;  // DVM Job Result
export const ANCHR_QUERY_FEEDBACK = 7000;  // DVM Job Feedback (quotes, selection, settlement)

// Marketplace listing (NIP-33 parameterized replaceable, Routstr-compatible).
export const ANCHR_MARKETPLACE_LISTING = 38421;
/** @deprecated Use ANCHR_QUERY_FEEDBACK */
export const ANCHR_QUERY_SETTLEMENT = ANCHR_QUERY_FEEDBACK;

// --- Payload types ---

export interface QueryRequestPayload {
  description: string;
  nonce?: string;
  /** Oracle's Nostr pubkey (hex) — Workers verify against whitelist. */
  oracle_pubkey?: string;
  /** Requester's Nostr pubkey (hex) — Workers encrypt K_R to this. */
  requester_pubkey?: string;
  bounty?: {
    mint: string;
    token: string;
  };
  oracle_ids?: string[];
  /** Verification factors requested by the Requester. */
  verification_requirements?: readonly VerificationFactor[];
  expires_at: number;
}

export interface QueryResponsePayload {
  nonce_echo: string;
  attachments?: Array<{
    blossom_hash: string;
    blossom_urls: string[];
    /** Symmetric key encrypted to Requester pubkey (NIP-44). */
    decrypt_key_requester?: string;
    /** Symmetric key encrypted to Oracle pubkey (NIP-44). */
    decrypt_key_oracle?: string;
    /** IV for AES-256-GCM decryption (hex). */
    decrypt_iv: string;
    mime: string;
    /** @deprecated Use decrypt_key_requester */
    decrypt_key?: string;
  }>;
  notes?: string;
}

/** Worker quote: kind 7000 with status=payment-required. */
export interface QuoteFeedbackPayload {
  status: "payment-required";
  /** Worker's Nostr pubkey (hex). */
  worker_pubkey: string;
  /** Requested amount in sats. */
  amount_sats?: number;
}

/** Requester selection announcement: kind 7000 with status=processing. */
export interface SelectionFeedbackPayload {
  status: "processing";
  /** Selected Worker's Nostr pubkey (hex). */
  selected_worker_pubkey: string;
  /** HTLC token (swapped to include Worker pubkey). */
  htlc_token?: string;
  /** Sensitive TLSNotary context for proof generation (target_url, headers).
   *  Delivered only to the selected Worker via NIP-44 encrypted kind 7000 event. */
  encrypted_context?: TlsnEncryptedContext;
}

/** Completion feedback: kind 7000 with status=success or error. */
export interface CompletionFeedbackPayload {
  status: "success" | "error";
  reason?: string;
  cashu_token?: string;
}

/** Legacy settlement payload (backward compat). */
export interface QuerySettlementPayload {
  status: "accepted" | "rejected";
  cashu_token?: string;
  reason?: string;
}

/** Union of all kind 7000 feedback payload types. */
export type FeedbackPayload =
  | QuoteFeedbackPayload
  | SelectionFeedbackPayload
  | CompletionFeedbackPayload
  | QuerySettlementPayload;

/** Preimage delivery via NIP-44 DM (kind 4). */
export interface PreimageDMPayload {
  type: "preimage";
  query_id: string;
  preimage: string;
}

/** Rejection notice via NIP-44 DM (kind 4). */
export interface RejectionDMPayload {
  type: "rejection";
  query_id: string;
  reason: string;
}

export type OracleDMPayload = PreimageDMPayload | RejectionDMPayload;

/**
 * Oracle-accessible payload embedded in kind 6300 tags.
 * Encrypted to Oracle via NIP-44 so only Oracle can read it.
 */
export interface OracleResponsePayload {
  nonce_echo: string;
  attachments: Array<{
    blossom_hash: string;
    blossom_urls: string[];
    decrypt_key_oracle: string;
    decrypt_iv: string;
    mime: string;
  }>;
  notes?: string;
}

// --- Event builders (delegated to event-builders.ts) ---

export {
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuoteFeedbackEvent,
  buildSelectionFeedbackEvent,
  buildQuerySettlementEvent,
} from "./event-builders";

// --- Parsers ---

export function parseQueryRequestPayload(content: string): QueryRequestPayload {
  return JSON.parse(content) as QueryRequestPayload;
}

export function parseQueryResponsePayload(
  content: string,
  secretKey: Uint8Array,
  senderPubKey: string,
): QueryResponsePayload {
  const conversationKey = deriveConversationKey(secretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as QueryResponsePayload;
}

export function parseOracleResponsePayload(
  event: { tags: string[][]; pubkey: string },
  oracleSecretKey: Uint8Array,
): OracleResponsePayload | null {
  const oracleTag = event.tags.find((t) => t[0] === "oracle_payload" && t[1]);
  if (!oracleTag) return null;

  const conversationKey = deriveConversationKey(oracleSecretKey, event.pubkey);
  const decrypted = decryptNip44(oracleTag[1]!, conversationKey);
  return JSON.parse(decrypted) as OracleResponsePayload;
}

export function parseQuerySettlementPayload(
  content: string,
  secretKey: Uint8Array,
  senderPubKey: string,
): QuerySettlementPayload {
  const conversationKey = deriveConversationKey(secretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as QuerySettlementPayload;
}

export function parseFeedbackPayload(
  content: string,
  secretKey: Uint8Array,
  senderPubKey: string,
): FeedbackPayload {
  const conversationKey = deriveConversationKey(secretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as FeedbackPayload;
}
