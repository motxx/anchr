/**
 * NIP-44 Direct Messages (kind 4) for Oracle ↔ Worker communication.
 *
 * Used for:
 *   - Oracle → Worker: preimage delivery on C2PA verification pass
 *   - Oracle → Worker: rejection notice on verification fail
 */

import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import type { NostrIdentity } from "./identity";
import { deriveConversationKey, encryptNip44, decryptNip44 } from "./encryption";
import type { OracleDMPayload, PreimageDMPayload, RejectionDMPayload, FrostSignatureDMPayload } from "./events";
export type { OracleDMPayload, FrostSignatureDMPayload } from "./events";

/** NIP-04/NIP-44 Direct Message kind. */
export const DM_KIND = 4;

/**
 * Build a preimage delivery DM (Oracle → Worker).
 *
 * On C2PA verification pass, the Oracle sends the HTLC preimage
 * to the Worker via encrypted DM. The Worker uses this preimage
 * combined with their signature to redeem the HTLC token.
 */
export function buildPreimageDM(
  oracleIdentity: NostrIdentity,
  workerPubKey: string,
  queryId: string,
  preimage: string,
): VerifiedEvent {
  const payload: PreimageDMPayload = {
    type: "preimage",
    query_id: queryId,
    preimage,
  };

  const conversationKey = deriveConversationKey(oracleIdentity.secretKey, workerPubKey);
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: DM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", workerPubKey],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, oracleIdentity.secretKey);
}

/**
 * Build a rejection DM (Oracle → Worker).
 *
 * On C2PA verification failure, the Oracle notifies the Worker
 * so they can stop waiting. The HTLC will eventually time out
 * and the Requester reclaims automatically.
 */
export function buildRejectionDM(
  oracleIdentity: NostrIdentity,
  workerPubKey: string,
  queryId: string,
  reason: string,
): VerifiedEvent {
  const payload: RejectionDMPayload = {
    type: "rejection",
    query_id: queryId,
    reason,
  };

  const conversationKey = deriveConversationKey(oracleIdentity.secretKey, workerPubKey);
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: DM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", workerPubKey],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, oracleIdentity.secretKey);
}

/**
 * Build a FROST group signature delivery DM (Oracle → Worker).
 *
 * For P2PK+FROST escrow, the Oracle sends the FROST group signature
 * instead of an HTLC preimage. The Worker uses this signature as
 * the second key in the 2-of-2 P2PK redemption.
 */
export function buildFrostSignatureDM(
  oracleIdentity: NostrIdentity,
  workerPubKey: string,
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

  const conversationKey = deriveConversationKey(oracleIdentity.secretKey, workerPubKey);
  const encrypted = encryptNip44(JSON.stringify(payload), conversationKey);

  const template: EventTemplate = {
    kind: DM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", workerPubKey],
    ],
    content: encrypted,
  };

  return finalizeEvent(template, oracleIdentity.secretKey);
}

/**
 * Parse an Oracle DM (preimage, rejection, or FROST signature).
 */
export function parseOracleDM(
  content: string,
  recipientSecretKey: Uint8Array,
  senderPubKey: string,
): OracleDMPayload {
  const conversationKey = deriveConversationKey(recipientSecretKey, senderPubKey);
  const decrypted = decryptNip44(content, conversationKey);
  return JSON.parse(decrypted) as OracleDMPayload;
}
