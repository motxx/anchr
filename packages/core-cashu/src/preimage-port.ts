/**
 * PreimageStore port — application-layer interface for preimage management.
 *
 * Decouples the application layer from any specific preimage storage
 * implementation (in-memory, file-backed, database, etc.).
 */

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
