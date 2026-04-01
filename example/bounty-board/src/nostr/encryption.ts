import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { nip44 } from "nostr-tools";

const PROTOCOL_VERSION = "anchr:v1";

export function deriveRegionKey(regionCode: string): Uint8Array {
  const input = `${PROTOCOL_VERSION}:${regionCode.toUpperCase()}`;
  return sha256(new TextEncoder().encode(input));
}

export function deriveConversationKey(
  secretKey: Uint8Array,
  recipientPubKey: string,
): Uint8Array {
  return nip44.v2.utils.getConversationKey(secretKey, recipientPubKey);
}

export function encryptNip44(plaintext: string, conversationKey: Uint8Array): string {
  return nip44.v2.encrypt(plaintext, conversationKey);
}

export function decryptNip44(ciphertext: string, conversationKey: Uint8Array): string {
  return nip44.v2.decrypt(ciphertext, conversationKey);
}

export function regionKeyHex(regionCode: string): string {
  return bytesToHex(deriveRegionKey(regionCode));
}
