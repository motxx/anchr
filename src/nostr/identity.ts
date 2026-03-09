/**
 * Ephemeral Nostr identity management.
 *
 * Each query session uses a fresh keypair.
 * No persistent identity = no tracking across queries.
 */

import { generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export interface NostrIdentity {
  secretKey: Uint8Array;
  publicKey: string;
  /** Hex-encoded secret key for serialization */
  secretKeyHex: string;
}

/**
 * Generate a fresh ephemeral Nostr keypair.
 * Each query should use a new identity.
 */
export function generateEphemeralIdentity(): NostrIdentity {
  const secretKey = generateSecretKey();
  const publicKey = getPublicKey(secretKey);
  return {
    secretKey,
    publicKey,
    secretKeyHex: bytesToHex(secretKey),
  };
}

/**
 * Restore identity from a hex-encoded secret key.
 */
export function restoreIdentity(secretKeyHex: string): NostrIdentity {
  const secretKey = hexToBytes(secretKeyHex);
  const publicKey = getPublicKey(secretKey);
  return {
    secretKey,
    publicKey,
    secretKeyHex,
  };
}
