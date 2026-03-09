/**
 * Encryption utilities for Ground Truth Protocol over Nostr.
 *
 * Two modes:
 * 1. Region-key encryption: Derive a shared key from region code.
 *    Any worker in that region can decrypt. Relays see region tag but not content.
 *
 * 2. NIP-44 encryption: 1-to-1 encrypted messages between requester and worker.
 *    Only the two parties can decrypt.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { nip44 } from "nostr-tools";

const PROTOCOL_VERSION = "ground-truth:v1";

/**
 * Derive a region key from a region code (e.g., "IR", "CN", "JP").
 * The key is deterministic: anyone who knows the region code can derive it.
 * This is intentional — the goal is to hide content from relay operators,
 * not from motivated adversaries (they can brute-force ~250 region codes).
 */
export function deriveRegionKey(regionCode: string): Uint8Array {
  const input = `${PROTOCOL_VERSION}:${regionCode.toUpperCase()}`;
  return sha256(new TextEncoder().encode(input));
}

/**
 * Derive a conversation key for NIP-44 encryption between two parties.
 */
export function deriveConversationKey(
  secretKey: Uint8Array,
  recipientPubKey: string,
): Uint8Array {
  return nip44.v2.utils.getConversationKey(secretKey, recipientPubKey);
}

/**
 * Encrypt content using NIP-44 (1-to-1, for responses and settlements).
 */
export function encryptNip44(
  plaintext: string,
  conversationKey: Uint8Array,
): string {
  return nip44.v2.encrypt(plaintext, conversationKey);
}

/**
 * Decrypt NIP-44 encrypted content.
 */
export function decryptNip44(
  ciphertext: string,
  conversationKey: Uint8Array,
): string {
  return nip44.v2.decrypt(ciphertext, conversationKey);
}

/**
 * Derive a hex string region key for use as a Nostr "secret key" in NIP-44.
 * This allows us to use NIP-44's encryption with a region-derived key.
 */
export function regionKeyHex(regionCode: string): string {
  return bytesToHex(deriveRegionKey(regionCode));
}
