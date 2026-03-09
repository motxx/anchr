/**
 * Ground Truth Protocol Nostr event builders and parsers.
 *
 * Event kinds:
 *   30100 - QueryRequest (parametric replaceable)
 *   30101 - QueryResponse
 *   30102 - QuerySettlement
 */

import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import type { NostrIdentity } from "./identity";
import { deriveConversationKey, encryptNip44, decryptNip44 } from "./encryption";

// Custom NIP event kinds for Ground Truth Protocol
export const GT_QUERY_REQUEST = 30100;
export const GT_QUERY_RESPONSE = 30101;
export const GT_QUERY_SETTLEMENT = 30102;

export interface QueryRequestPayload {
  type: string;
  params: Record<string, unknown>;
  nonce: string;
  bounty?: {
    mint: string;
    token: string;
  };
  oracle_ids?: string[];
  expires_at: number;
}

export interface QueryResponsePayload {
  text_answer?: string;
  nonce_echo: string;
  attachments?: Array<{
    blossom_hash: string;
    blossom_urls: string[];
    decrypt_key: string;
    mime: string;
  }>;
  notes?: string;
  status?: string;
  answer?: string;
  proof_text?: string;
}

export interface QuerySettlementPayload {
  status: "accepted" | "rejected";
  cashu_token?: string;
  reason?: string;
}

/**
 * Build a QueryRequest event.
 * Content is JSON (optionally encrypted by caller before passing).
 */
export function buildQueryRequestEvent(
  identity: NostrIdentity,
  queryId: string,
  payload: QueryRequestPayload,
  regionCode?: string,
): VerifiedEvent {
  const tags: string[][] = [
    ["d", queryId],
    ["t", "ground-truth"],
    ["t", payload.type],
    ["expiration", String(Math.floor(payload.expires_at / 1000))],
  ];

  if (regionCode) {
    tags.push(["region", regionCode.toUpperCase()]);
  }

  const template: EventTemplate = {
    kind: GT_QUERY_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(payload),
  };

  return finalizeEvent(template, identity.secretKey);
}

/**
 * Build a QueryResponse event (NIP-44 encrypted to requester).
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
    kind: GT_QUERY_RESPONSE,
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
 * Build a QuerySettlement event (NIP-44 encrypted to worker).
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
    kind: GT_QUERY_SETTLEMENT,
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
