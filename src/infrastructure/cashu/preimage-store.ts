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

/** JSON file format for persistent preimage store. */
interface PreimageFileData {
  entries: { [hash: string]: PreimageEntry };
}

/**
 * Read the JSON file and return the entries map.
 * Returns an empty map if the file does not exist.
 */
function loadFromFile(filePath: string): Map<string, PreimageEntry> {
  try {
    const text = Deno.readTextFileSync(filePath);
    const data: PreimageFileData = JSON.parse(text);
    return new Map(Object.entries(data.entries));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return new Map();
    }
    throw e;
  }
}

/**
 * Atomically write the entries map to the JSON file.
 * Writes to a temp file first, then renames to prevent corruption.
 */
function saveToFile(
  filePath: string,
  entries: Map<string, PreimageEntry>,
): void {
  const data: PreimageFileData = {
    entries: Object.fromEntries(entries),
  };
  const json = JSON.stringify(data, null, 2);
  const tmpPath = filePath + ".tmp";
  Deno.writeTextFileSync(tmpPath, json);
  Deno.renameSync(tmpPath, filePath);
}

/**
 * Create a persistent preimage store backed by a JSON file.
 *
 * Reads existing entries from the file on initialization.
 * Writes atomically (temp file + rename) on every create() and delete().
 */
export function createPersistentPreimageStore(
  filePath: string,
): PreimageStore {
  const entries = loadFromFile(filePath);

  return {
    create(): PreimageEntry {
      const { hash, preimage } = createHTLCHash();
      const entry: PreimageEntry = {
        hash,
        preimage,
        created_at: Date.now(),
      };
      entries.set(hash, entry);
      saveToFile(filePath, entries);
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
      saveToFile(filePath, entries);
    },
  };
}
