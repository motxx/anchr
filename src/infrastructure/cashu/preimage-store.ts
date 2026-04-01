/**
 * Preimage store for HTLC escrow.
 *
 * The Oracle generates a random preimage, stores it secretly, and
 * returns only hash(preimage) to the Requester. The hash is the
 * primary key — it uniquely identifies the HTLC.
 *
 * On verification pass, the Oracle reveals the preimage to the
 * Worker, allowing HTLC redemption on the Cashu mint.
 */

import { createHTLCHash, verifyHTLCHash } from "@cashu/cashu-ts";

export interface PreimageEntry {
  hash: string;
  preimage: string;
  created_at: number;
}

export interface PreimageStore {
  /** Generate a new preimage/hash pair. Returns the entry (hash is the key). */
  create(): PreimageEntry;
  /** Retrieve the preimage by hash (Oracle-only). */
  getPreimage(hash: string): string | null;
  /** Check if a hash exists in the store. */
  has(hash: string): boolean;
  /** Verify a preimage matches the stored hash. */
  verify(hash: string, preimage: string): boolean;
  /** Delete the entry (after delivery or expiry). */
  delete(hash: string): void;
}

export function createPreimageStore(): PreimageStore {
  const entries = new Map<string, PreimageEntry>();

  return {
    create(): PreimageEntry {
      const { hash, preimage } = createHTLCHash();
      const entry: PreimageEntry = {
        hash,
        preimage,
        created_at: Date.now(),
      };
      entries.set(hash, entry);
      return entry;
    },

    getPreimage(hash: string): string | null {
      return entries.get(hash)?.preimage ?? null;
    },

    has(hash: string): boolean {
      return entries.has(hash);
    },

    verify(hash: string, preimage: string): boolean {
      const entry = entries.get(hash);
      if (!entry) return false;
      return verifyHTLCHash(preimage, entry.hash);
    },

    delete(hash: string): void {
      entries.delete(hash);
    },
  };
}
