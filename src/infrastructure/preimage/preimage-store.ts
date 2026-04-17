/**
 * Preimage store for HTLC escrow — decoupled from Cashu.
 *
 * Uses @noble/hashes for SHA-256 instead of @cashu/cashu-ts,
 * so the preimage/hash lifecycle is independent of the escrow provider.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { PreimageEntry, PreimageStore } from "../../application/preimage-port";
// Re-export port interfaces for backward compatibility
export type { PreimageEntry, PreimageStore } from "../../application/preimage-port";

function createPreimage(): { preimage: string; hash: string } {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const preimage = bytesToHex(raw);
  const hash = bytesToHex(sha256(raw));
  return { preimage, hash };
}

function verifyPreimageHash(preimage: string, hash: string): boolean {
  const raw = new Uint8Array(preimage.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const computed = bytesToHex(sha256(raw));
  return computed === hash;
}

export function createPreimageStore(): PreimageStore {
  const entries = new Map<string, PreimageEntry>();

  return {
    create(): PreimageEntry {
      const { hash, preimage } = createPreimage();
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
      return verifyPreimageHash(preimage, entry.hash);
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
      const { hash, preimage } = createPreimage();
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
      return verifyPreimageHash(preimage, entry.hash);
    },

    delete(hash: string): void {
      entries.delete(hash);
      saveToFile(filePath, entries);
    },
  };
}
