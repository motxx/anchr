/**
 * Nostr event builder functions for Anchr NIP-90 DVM events.
 */

import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import type { NostrIdentity } from "./identity";
import { deriveConversationKey, encryptNip44 } from "./encryption";
import {
  ANCHR_QUERY_REQUEST,
  ANCHR_QUERY_RESPONSE,
  ANCHR_QUERY_FEEDBACK,
  type QueryRequestPayload,
  type QueryResponsePayload,
  type QuoteFeedbackPayload,
  type SelectionFeedbackPayload,
  type QuerySettlementPayload,
  type OracleResponsePayload,
} from "./events";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function encryptPayload(identity: NostrIdentity, recipientPubKey: string, payload: unknown): string {
  const conversationKey = deriveConversationKey(identity.secretKey, recipientPubKey);
  return encryptNip44(JSON.stringify(payload), conversationKey);
}

function buildRequestTags(
  queryId: string,
  payload: QueryRequestPayload,
  regionCode?: string,
): string[][] {
  const tags: string[][] = [
    ["i", payload.description, "text"],
    ["output", "application/json"],
    ["encrypted"],
    ["d", queryId],
    ["t", "anchr"],
    ["expiration", String(Math.floor(payload.expires_at / 1000))],
  ];

  if (payload.nonce) {
    tags.push(["param", "nonce", payload.nonce]);
  }
  if (payload.verification_requirements?.length) {
    tags.push(["param", "verification", payload.verification_requirements.join(",")]);
  }
  if (payload.bounty?.token) {
    tags.push(["bid", payload.bounty.token]);
  }
  if (payload.oracle_pubkey) {
    tags.push(["p", payload.oracle_pubkey, "", "oracle"]);
  }
  if (regionCode) {
    tags.push(["region", regionCode.toUpperCase()]);
  }

  return tags;
}

function buildResponseTags(
  identity: NostrIdentity,
  queryEventId: string,
  requesterPubKey: string,
  payload: QueryResponsePayload,
  oraclePubKey?: string,
): string[][] {
  const tags: string[][] = [
    ["e", queryEventId],
    ["p", requesterPubKey],
  ];

  if (oraclePubKey && payload.attachments?.length) {
    appendOracleTags(tags, identity, payload, oraclePubKey);
  }

  return tags;
}

function appendOracleTags(
  tags: string[][],
  identity: NostrIdentity,
  payload: QueryResponsePayload,
  oraclePubKey: string,
): void {
  tags.push(["p", oraclePubKey, "", "oracle"]);

  for (const att of payload.attachments!) {
    tags.push(["x", att.blossom_hash]);
    for (const url of att.blossom_urls) {
      tags.push(["blossom", url]);
    }
  }

  const oraclePayload: OracleResponsePayload = {
    nonce_echo: payload.nonce_echo,
    attachments: payload.attachments!
      .filter((a) => a.decrypt_key_oracle)
      .map((a) => ({
        blossom_hash: a.blossom_hash,
        blossom_urls: a.blossom_urls,
        decrypt_key_oracle: a.decrypt_key_oracle!,
        decrypt_iv: a.decrypt_iv,
        mime: a.mime,
      })),
    notes: payload.notes,
  };

  const encrypted = encryptPayload(identity, oraclePubKey, oraclePayload);
  tags.push(["oracle_payload", encrypted]);
}

export function buildQueryRequestEvent(
  identity: NostrIdentity,
  queryId: string,
  payload: QueryRequestPayload,
  regionCode?: string,
): VerifiedEvent {
  const template: EventTemplate = {
    kind: ANCHR_QUERY_REQUEST,
    created_at: nowUnix(),
    tags: buildRequestTags(queryId, payload, regionCode),
    content: JSON.stringify(payload),
  };
  return finalizeEvent(template, identity.secretKey);
}

export function buildQueryResponseEvent(
  identity: NostrIdentity,
  queryEventId: string,
  requesterPubKey: string,
  payload: QueryResponsePayload,
  oraclePubKey?: string,
): VerifiedEvent {
  const template: EventTemplate = {
    kind: ANCHR_QUERY_RESPONSE,
    created_at: nowUnix(),
    tags: buildResponseTags(identity, queryEventId, requesterPubKey, payload, oraclePubKey),
    content: encryptPayload(identity, requesterPubKey, payload),
  };
  return finalizeEvent(template, identity.secretKey);
}

export function buildQuoteFeedbackEvent(
  identity: NostrIdentity,
  queryEventId: string,
  requesterPubKey: string,
  payload: QuoteFeedbackPayload,
): VerifiedEvent {
  const template: EventTemplate = {
    kind: ANCHR_QUERY_FEEDBACK,
    created_at: nowUnix(),
    tags: [
      ["e", queryEventId],
      ["p", requesterPubKey],
      ["status", "payment-required"],
    ],
    content: encryptPayload(identity, requesterPubKey, payload),
  };
  return finalizeEvent(template, identity.secretKey);
}

export function buildSelectionFeedbackEvent(
  identity: NostrIdentity,
  queryEventId: string,
  workerPubKey: string,
  payload: SelectionFeedbackPayload,
): VerifiedEvent {
  const template: EventTemplate = {
    kind: ANCHR_QUERY_FEEDBACK,
    created_at: nowUnix(),
    tags: [
      ["e", queryEventId],
      ["p", workerPubKey],
      ["status", "processing"],
    ],
    content: encryptPayload(identity, workerPubKey, payload),
  };
  return finalizeEvent(template, identity.secretKey);
}

export function buildQuerySettlementEvent(
  identity: NostrIdentity,
  queryEventId: string,
  responseEventId: string,
  workerPubKey: string,
  payload: QuerySettlementPayload,
): VerifiedEvent {
  const template: EventTemplate = {
    kind: ANCHR_QUERY_FEEDBACK,
    created_at: nowUnix(),
    tags: [
      ["e", queryEventId],
      ["e", responseEventId],
      ["p", workerPubKey],
    ],
    content: encryptPayload(identity, workerPubKey, payload),
  };
  return finalizeEvent(template, identity.secretKey);
}
