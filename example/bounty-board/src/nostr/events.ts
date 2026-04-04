import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import type { VerificationFactor } from "../api/types";
import type { NostrIdentity } from "./identity";
import { deriveConversationKey, encryptNip44, decryptNip44 } from "./encryption";

export const ANCHR_QUERY_REQUEST = 5300;
export const ANCHR_QUERY_RESPONSE = 6300;
export const ANCHR_QUERY_FEEDBACK = 7000;

export interface QueryRequestPayload {
  description: string;
  nonce?: string;
  oracle_pubkey?: string;
  requester_pubkey?: string;
  bounty?: { mint: string; token: string };
  oracle_ids?: string[];
  verification_requirements?: readonly VerificationFactor[];
  expires_at: number;
}

export interface QueryResponsePayload {
  nonce_echo: string;
  attachments?: Array<{
    blossom_hash: string;
    blossom_urls: string[];
    decrypt_key_requester?: string;
    decrypt_key_oracle?: string;
    decrypt_iv: string;
    mime: string;
  }>;
  notes?: string;
}

export interface QuoteFeedbackPayload {
  status: "payment-required";
  worker_pubkey: string;
  amount_sats?: number;
}

export interface SelectionFeedbackPayload {
  status: "processing";
  selected_worker_pubkey: string;
  htlc_token?: string;
}

export interface CompletionFeedbackPayload {
  status: "success" | "error";
  reason?: string;
  cashu_token?: string;
}

export type FeedbackPayload =
  | QuoteFeedbackPayload
  | SelectionFeedbackPayload
  | CompletionFeedbackPayload;

export function buildQueryRequestEvent(
  identity: NostrIdentity,
  queryId: string,
  payload: QueryRequestPayload,
  regionCode?: string,
): VerifiedEvent {
  const tags: string[][] = [
    ["i", payload.description, "text"],
    ["output", "application/json"],
    ["encrypted"],
    ["d", queryId],
    ["t", "anchr"],
    ["expiration", String(Math.floor(payload.expires_at / 1000))],
  ];

  if (payload.nonce) tags.push(["param", "nonce", payload.nonce]);
  if (payload.verification_requirements?.length) {
    tags.push(["param", "verification", payload.verification_requirements.join(",")]);
  }
  if (payload.bounty?.token) tags.push(["bid", payload.bounty.token]);
  if (payload.oracle_pubkey) tags.push(["p", payload.oracle_pubkey, "", "oracle"]);
  if (regionCode) tags.push(["region", regionCode.toUpperCase()]);

  const template: EventTemplate = {
    kind: ANCHR_QUERY_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(payload),
  };

  return finalizeEvent(template, identity.secretKey);
}

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

export function parseQueryRequestPayload(content: string): QueryRequestPayload {
  return JSON.parse(content) as QueryRequestPayload;
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
