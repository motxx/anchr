/**
 * Client-side Nostr keypair management for prediction markets.
 *
 * Generates a secp256k1 keypair on first visit, stores the secret key
 * in localStorage, and never sends it to the server. Only the public key
 * is shared with the backend for HTLC lock conditions.
 */

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

const SK_STORAGE_KEY = "anchr_market_sk";

interface Keypair {
  secretKey: Uint8Array;
  publicKey: string;
}

/** Singleton — cached after first call within the same page session. */
let cached: Keypair | null = null;

/**
 * Get or create a Nostr keypair for this browser session.
 *
 * - On first visit: generates a new secp256k1 keypair, stores the secret
 *   key as hex in localStorage under `anchr_market_sk`.
 * - On subsequent visits: loads the stored secret key and derives the pubkey.
 * - The secret key NEVER leaves the browser.
 */
export function getOrCreateKeypair(): Keypair {
  if (cached) return cached;

  let secretKey: Uint8Array;

  const stored = localStorage.getItem(SK_STORAGE_KEY);
  if (stored) {
    // Restore from hex
    secretKey = hexToBytes(stored);
  } else {
    // Generate new keypair
    secretKey = generateSecretKey();
    localStorage.setItem(SK_STORAGE_KEY, bytesToHex(secretKey));
  }

  const publicKey = getPublicKey(secretKey);
  cached = { secretKey, publicKey };
  return cached;
}

/**
 * Convenience: get just the user's public key (hex).
 * Safe to call from any component.
 */
export function getUserPubkey(): string {
  return getOrCreateKeypair().publicKey;
}

/**
 * Truncate a hex pubkey for display: first 8 chars + "..." + last 4 chars.
 */
export function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 16) return pubkey;
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`;
}

// --- Hex utilities (no dependency on @noble/hashes in browser bundle) ---

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
