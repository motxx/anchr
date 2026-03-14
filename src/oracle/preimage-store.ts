/**
 * Preimage store for HTLC escrow.
 *
 * The Oracle generates a random preimage for each query, stores it
 * secretly, and returns only hash(preimage) to the Requester.
 *
 * On C2PA verification pass, the Oracle delivers the preimage to the
 * Worker via NIP-44 DM, allowing HTLC redemption.
 */

import { createHTLCHash, verifyHTLCHash } from "@cashu/cashu-ts";

export interface PreimageEntry {
  hash: string;
  preimage: string;
  query_id: string;
  created_at: number;
}

export interface PreimageStore {
  /** Generate a new preimage/hash pair for a query. */
  create(queryId: string): PreimageEntry;
  /** Retrieve the preimage for a query (Oracle-only). */
  getPreimage(queryId: string): string | null;
  /** Retrieve the hash for a query. */
  getHash(queryId: string): string | null;
  /** Verify a preimage matches the stored hash. */
  verify(queryId: string, preimage: string): boolean;
  /** Delete the entry (after delivery or expiry). */
  delete(queryId: string): void;
}

export function createPreimageStore(): PreimageStore {
  const entries = new Map<string, PreimageEntry>();

  return {
    create(queryId: string): PreimageEntry {
      const { hash, preimage } = createHTLCHash();
      const entry: PreimageEntry = {
        hash,
        preimage,
        query_id: queryId,
        created_at: Date.now(),
      };
      entries.set(queryId, entry);
      return entry;
    },

    getPreimage(queryId: string): string | null {
      return entries.get(queryId)?.preimage ?? null;
    },

    getHash(queryId: string): string | null {
      return entries.get(queryId)?.hash ?? null;
    },

    verify(queryId: string, preimage: string): boolean {
      const entry = entries.get(queryId);
      if (!entry) return false;
      return verifyHTLCHash(preimage, entry.hash);
    },

    delete(queryId: string): void {
      entries.delete(queryId);
    },
  };
}
