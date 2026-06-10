/**
 * SDK-local Oracle and DM payload shapes that ride next to the canonical
 * wire contract (`@anchr/protocol/events`): Oracle↔Provider release DMs
 * and the Oracle-readable result payload carried in `oracle_payload` tags.
 */

import { decryptNip44, deriveConversationKey } from "../crypto/encryption.ts";

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

/** FROST group signature delivery via NIP-44 DM (kind 4). */
export interface FrostSignatureDMPayload {
  type: "frost_signature";
  query_id: string;
  /** BIP-340 Schnorr signature hex (from FROST threshold signing). */
  group_signature: string;
  /** FROST group public key for verification. */
  group_pubkey: string;
}

export type OracleDMPayload =
  | PreimageDMPayload
  | RejectionDMPayload
  | FrostSignatureDMPayload;

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

export { buildOracleAnnouncementEvent } from "./event-builders.ts";
