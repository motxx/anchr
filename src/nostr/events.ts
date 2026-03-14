/**
 * Anchr Nostr event builders and parsers.
 *
 * Uses NIP-90 Data Vending Machine (DVM) event kinds so that any
 * DVM-aware client can discover and interact with Anchr queries.
 *
 * Event kind mapping (GT constant → DVM kind):
 *   ANCHR_QUERY_REQUEST   = 5300  (DVM Job Request)
 *   ANCHR_QUERY_RESPONSE  = 6300  (DVM Job Result)
 *   ANCHR_QUERY_SETTLEMENT = 7000 (DVM Job Feedback)
 *
 * OracleAttestation (30103) remains a custom parametric-replaceable kind.
 */

import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import type { NostrIdentity } from "./identity";
import { deriveConversationKey, encryptNip44, decryptNip44 } from "./encryption";

// NIP-90 DVM event kinds for Anchr.
export const ANCHR_QUERY_REQUEST = 5300;   // DVM Job Request
export const ANCHR_QUERY_RESPONSE = 6300;  // DVM Job Result
export const ANCHR_QUERY_SETTLEMENT = 7000; // DVM Job Feedback

export interface QueryRequestPayload {
  description: string;
  nonce: string;
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
    decrypt_key: string;
    decrypt_iv: string;
    mime: string;
  }>;
  notes?: string;
}

export interface QuerySettlementPayload {
  status: "accepted" | "rejected";
  cashu_token?: string;
  reason?: string;
}

/**
 * Build a QueryRequest event (NIP-90 DVM Job Request, kind 5300).
 *
 * Tag layout follows NIP-90 conventions:
 *   ["i", <input_text>, "text"]   - human-readable query subject
 *   ["param", "nonce", <nonce>]   - challenge nonce for proof-of-work
 *   ["bid", <amount_msats>]       - optional bounty hint
 *   ["output", "application/json"] - expected result MIME type
 *   ["encrypted"]                 - signals that the result should be NIP-44 encrypted
 *   ["d", <queryId>]              - deduplication / replaceable-event tag
 *   ["t", "anchr"]                - protocol marker
 *   ["t", <query_type>]           - query type tag
 *   ["expiration", <unix>]        - NIP-40 expiration
 *   ["region", <code>]            - optional region filter
 *
 * Content is JSON (optionally encrypted by caller before passing).
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

  // Add bid tag if bounty is present (value in msats-equivalent, token string)
  if (payload.bounty?.token) {
    tags.push(["bid", payload.bounty.token]);
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
 * Build a QuerySettlement event (NIP-90 DVM Job Feedback, kind 7000).
 * Content is NIP-44 encrypted to the worker. Carries Cashu token on acceptance.
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
    kind: ANCHR_QUERY_SETTLEMENT,
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

/**
 * Parse a QueryRequest event's content.
 */
export function parseQueryRequestPayload(content: string): QueryRequestPayload {
  return JSON.parse(content) as QueryRequestPayload;
}

/**
 * Decrypt and parse a QueryResponse event.
 */
export function parseQueryResponsePayload(
  content: string,
  secretKey: Uint8Array,
  senderPubKey: string,
): QueryResponsePayload {
  const conversationKey = deriveConversationKey(secretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as QueryResponsePayload;
}

/**
 * Decrypt and parse a QuerySettlement event.
 */
export function parseQuerySettlementPayload(
  content: string,
  secretKey: Uint8Array,
  senderPubKey: string,
): QuerySettlementPayload {
  const conversationKey = deriveConversationKey(secretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as QuerySettlementPayload;
}
