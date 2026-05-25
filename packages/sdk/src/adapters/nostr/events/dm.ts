// NIP-44 DM (kind 4) for Oracle ↔ Provider preimage / rejection delivery.

import {
  type EventTemplate,
  finalizeEvent,
  type VerifiedEvent,
} from "nostr-tools";
import type { NostrIdentity } from "../crypto/identity.ts";
import {
  decryptNip44,
  deriveConversationKey,
  encryptNip44,
} from "../crypto/encryption.ts";
import type {
  FrostSignatureDMPayload,
  OracleDMPayload,
  PreimageDMPayload,
  RejectionDMPayload,
} from "./events.ts";
export type { FrostSignatureDMPayload, OracleDMPayload } from "./events.ts";

export const DM_KIND = 4;

export function buildPreimageDM(
  oracleIdentity: NostrIdentity,
  providerPubKey: string,
  queryId: string,
  preimage: string,
): VerifiedEvent {
  const payload: PreimageDMPayload = {
    type: "preimage",
    query_id: queryId,
    preimage,
  };

  const conversationKey = deriveConversationKey(
    oracleIdentity.secretKey,
    providerPubKey,
  );
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: DM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", providerPubKey],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, oracleIdentity.secretKey);
}

export function buildRejectionDM(
  oracleIdentity: NostrIdentity,
  providerPubKey: string,
  queryId: string,
  reason: string,
): VerifiedEvent {
  const payload: RejectionDMPayload = {
    type: "rejection",
    query_id: queryId,
    reason,
  };

  const conversationKey = deriveConversationKey(
    oracleIdentity.secretKey,
    providerPubKey,
  );
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: DM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", providerPubKey],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, oracleIdentity.secretKey);
}

// In FROST mode the group signature replaces the HTLC preimage as the
// second key in the 2-of-2 P2PK redemption.
export function buildFrostSignatureDM(
  oracleIdentity: NostrIdentity,
  providerPubKey: string,
  queryId: string,
  groupSignature: string,
  groupPubkey: string,
): VerifiedEvent {
  const payload: FrostSignatureDMPayload = {
    type: "frost_signature",
    query_id: queryId,
    group_signature: groupSignature,
    group_pubkey: groupPubkey,
  };

  const conversationKey = deriveConversationKey(
    oracleIdentity.secretKey,
    providerPubKey,
  );
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: DM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", providerPubKey],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, oracleIdentity.secretKey);
}

export function parseOracleDM(
  content: string,
  recipientSecretKey: Uint8Array,
  senderPubKey: string,
): OracleDMPayload {
  const conversationKey = deriveConversationKey(
    recipientSecretKey,
    senderPubKey,
  );
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as OracleDMPayload;
}
