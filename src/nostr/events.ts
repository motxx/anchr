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

import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import type { NostrIdentity } from "./identity";
import { deriveConversationKey, encryptNip44, decryptNip44 } from "./encryption";

// NIP-90 DVM event kinds for Anchr.
export const ANCHR_QUERY_REQUEST = 5300;   // DVM Job Request
export const ANCHR_QUERY_RESPONSE = 6300;  // DVM Job Result
export const ANCHR_QUERY_FEEDBACK = 7000;  // DVM Job Feedback (quotes, selection, settlement)
/** @deprecated Use ANCHR_QUERY_FEEDBACK */
export const ANCHR_QUERY_SETTLEMENT = ANCHR_QUERY_FEEDBACK;

// --- Payload types ---

export interface QueryRequestPayload {
  description: string;
  nonce: string;
  /** Oracle's Nostr pubkey (hex) — Workers verify against whitelist. */
  oracle_pubkey?: string;
  /** Requester's Nostr pubkey (hex) — Workers encrypt K_R to this. */
  requester_pubkey?: string;
  bounty?: {
    mint: string;
    token: string;
  };
  oracle_ids?: string[];
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

// --- Event builders ---

/**
 * Build a QueryRequest event (NIP-90 DVM Job Request, kind 5300).
 */
export function buildQueryRequestEvent(
  identity: NostrIdentity,
  queryId: string,
  payload: QueryRequestPayload,
  regionCode?: string,
): VerifiedEvent {
  const tags: string[][] = [
    ["i", payload.description, "text"],
    ["param", "nonce", payload.nonce],
    ["output", "application/json"],
    ["encrypted"],
    ["d", queryId],
    ["t", "anchr"],
    ["expiration", String(Math.floor(payload.expires_at / 1000))],
  ];

  if (payload.bounty?.token) {
    tags.push(["bid", payload.bounty.token]);
  }

  if (payload.oracle_pubkey) {
    tags.push(["p", payload.oracle_pubkey, "", "oracle"]);
  }

  if (regionCode) {
    tags.push(["region", regionCode.toUpperCase()]);
  }

  const template: EventTemplate = {
    kind: ANCHR_QUERY_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(payload),
  };

  return finalizeEvent(template, identity.secretKey);
}

/**
 * Build a QueryResponse event (NIP-90 DVM Job Result, kind 6300).
 * Content is NIP-44 encrypted to the requester.
 */
export function buildQueryResponseEvent(
  identity: NostrIdentity,
  queryEventId: string,
  requesterPubKey: string,
  payload: QueryResponsePayload,
): VerifiedEvent {
  const conversationKey = deriveConversationKey(identity.secretKey, requesterPubKey);
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: ANCHR_QUERY_RESPONSE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", queryEventId],
      ["p", requesterPubKey],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, identity.secretKey);
}

/**
 * Build a Worker quote event (kind 7000, status=payment-required).
 * Content is NIP-44 encrypted to the requester.
 */
export function buildQuoteFeedbackEvent(
  identity: NostrIdentity,
  queryEventId: string,
  requesterPubKey: string,
  payload: QuoteFeedbackPayload,
): VerifiedEvent {
  const conversationKey = deriveConversationKey(identity.secretKey, requesterPubKey);
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: ANCHR_QUERY_FEEDBACK,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", queryEventId],
      ["p", requesterPubKey],
      ["status", "payment-required"],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, identity.secretKey);
}

/**
 * Build a selection announcement event (kind 7000, status=processing).
 * Content is NIP-44 encrypted to the selected worker.
 */
export function buildSelectionFeedbackEvent(
  identity: NostrIdentity,
  queryEventId: string,
  workerPubKey: string,
  payload: SelectionFeedbackPayload,
): VerifiedEvent {
  const conversationKey = deriveConversationKey(identity.secretKey, workerPubKey);
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: ANCHR_QUERY_FEEDBACK,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", queryEventId],
      ["p", workerPubKey],
      ["status", "processing"],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, identity.secretKey);
}

/**
 * Build a QuerySettlement event (kind 7000, legacy completion feedback).
 * Content is NIP-44 encrypted to the worker.
 */
export function buildQuerySettlementEvent(
  identity: NostrIdentity,
  queryEventId: string,
  responseEventId: string,
  workerPubKey: string,
  payload: QuerySettlementPayload,
): VerifiedEvent {
  const conversationKey = deriveConversationKey(identity.secretKey, workerPubKey);
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: ANCHR_QUERY_FEEDBACK,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", queryEventId],
      ["e", responseEventId],
      ["p", workerPubKey],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, identity.secretKey);
}

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
