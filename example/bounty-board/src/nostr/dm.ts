import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import type { NostrIdentity } from "./identity";
import { deriveConversationKey, encryptNip44, decryptNip44 } from "./encryption";

export const DM_KIND = 4;

export interface PreimageDMPayload {
  type: "preimage";
  query_id: string;
  preimage: string;
}

export interface RejectionDMPayload {
  type: "rejection";
  query_id: string;
  reason: string;
}

export type OracleDMPayload = PreimageDMPayload | RejectionDMPayload;

export function buildPreimageDM(
  identity: NostrIdentity,
  recipientPubKey: string,
  queryId: string,
  preimage: string,
): VerifiedEvent {
  const payload: PreimageDMPayload = { type: "preimage", query_id: queryId, preimage };
  const conversationKey = deriveConversationKey(identity.secretKey, recipientPubKey);
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: DM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", recipientPubKey]],
    content: encrypted,
  };

  return finalizeEvent(template, identity.secretKey);
}

export function parseOracleDM(
  content: string,
  recipientSecretKey: Uint8Array,
  senderPubKey: string,
): OracleDMPayload {
  const conversationKey = deriveConversationKey(recipientSecretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as OracleDMPayload;
}
