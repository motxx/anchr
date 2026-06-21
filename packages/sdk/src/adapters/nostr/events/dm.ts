// NIP-44 DM (kind 4) for Oracle ↔ Provider preimage / rejection delivery.

import {
  type EventTemplate,
  finalizeEvent,
  type VerifiedEvent,
} from "nostr-tools";
import { KIND_DIRECT_MESSAGE } from "@anchr/protocol/nostr";
import type { NostrIdentity } from "../../../identity.ts";
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

export function buildPreimageDM(
  oracleIdentity: NostrIdentity,
  providerPubKey: string,
  queryId: string,
  requestEventId: string,
  preimage: string,
): VerifiedEvent {
  const payload: PreimageDMPayload = {
    type: "preimage",
    query_id: queryId,
    request_event_id: requestEventId,
    preimage,
  };

  const conversationKey = deriveConversationKey(
    oracleIdentity.secretKey,
    providerPubKey,
  );
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: KIND_DIRECT_MESSAGE,
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
    kind: KIND_DIRECT_MESSAGE,
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
  groupSignature: string[],
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
    kind: KIND_DIRECT_MESSAGE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", providerPubKey],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, oracleIdentity.secretKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOracleDMPayload(value: unknown): value is OracleDMPayload {
  if (!isRecord(value)) return false;
  if (typeof value.query_id !== "string") return false;
  switch (value.type) {
    case "preimage":
      return typeof value.request_event_id === "string" &&
        typeof value.preimage === "string";
    case "rejection":
      return typeof value.reason === "string";
    case "frost_signature":
      return isStringArray(value.group_signature) &&
        typeof value.group_pubkey === "string";
    default:
      return false;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string");
}

/**
 * Decrypt + validate an Oracle release DM. Returns null when the content was
 * not encrypted to us or the decrypted payload does not match a known DM
 * shape — consumers ignore such events instead of acting on cast garbage.
 */
export function parseOracleDM(
  content: string,
  recipientSecretKey: Uint8Array,
  senderPubKey: string,
): OracleDMPayload | null {
  const conversationKey = deriveConversationKey(
    recipientSecretKey,
    senderPubKey,
  );
  let decrypted: string;
  try {
    decrypted = decryptNip44(content, conversationKey);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    return null;
  }
  return isOracleDMPayload(parsed) ? parsed : null;
}
