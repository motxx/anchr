/**
 * Preimage store for HTLC escrow — decoupled from Cashu.
 *
 * Uses @noble/hashes for SHA-256 instead of @cashu/cashu-ts,
 * so the preimage/hash lifecycle is independent of the escrow provider.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  createFileSystemPersistenceStore,
  isPersistenceNotFoundError,
  type PersistenceStore,
} from "../../adapters/storage.ts";
import type {
  PreimageEntry,
  PreimageStore,
} from "../../requests/application/ports.ts";
export type {
  PreimageEntry,
  PreimageStore,
} from "../../requests/application/ports.ts";

function createPreimage(): { preimage: string; hash: string } {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const preimage = bytesToHex(raw);
  const hash = bytesToHex(sha256(raw));
  return { preimage, hash };
}

function verifyPreimageHash(preimage: string, hash: string): boolean {
  const raw = new Uint8Array(
    preimage.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  const computed = bytesToHex(sha256(raw));
  return computed === hash;
}

export function createPreimageStore(): PreimageStore {
  const entries = new Map<string, PreimageEntry>();

  return {
    create(): Promise<PreimageEntry> {
      const { hash, preimage } = createPreimage();
      const entry: PreimageEntry = {
        hash,
        preimage,
        created_at: Date.now(),
      };
      entries.set(hash, entry);
      return Promise.resolve(entry);
    },

    getPreimage(hash: string): Promise<string | null> {
      return Promise.resolve(entries.get(hash)?.preimage ?? null);
    },

    has(hash: string): Promise<boolean> {
      return Promise.resolve(entries.has(hash));
    },

    verify(hash: string, preimage: string): Promise<boolean> {
      const entry = entries.get(hash);
      if (!entry) return Promise.resolve(false);
      return Promise.resolve(verifyPreimageHash(preimage, entry.hash));
    },

    delete(hash: string): Promise<void> {
      entries.delete(hash);
      return Promise.resolve();
    },
  };
}

/**
 * Get-or-create the hash commitment for a query. Single owner of the
 * query-id → hash issuance rule shared by the relay-DM Oracle service and
 * the HTTP Oracle routes: one hash per query id, idempotent across retries.
 */
export async function issueQueryHash(
  preimageStore: PreimageStore,
  queryHashMap: Map<string, string>,
  queryId: string,
): Promise<{ hash: string; created: boolean }> {
  const existing = queryHashMap.get(queryId);
  if (existing !== undefined) return { hash: existing, created: false };
  const entry = await preimageStore.create();
  queryHashMap.set(queryId, entry.hash);
  return { hash: entry.hash, created: true };
}

/** JSON file format for persistent preimage store. */
interface PreimageFileData {
  entries: { [hash: string]: PreimageEntry };
}

/**
 * Read the JSON file and return the entries map.
 * Returns an empty map if the file does not exist.
 */
async function loadFromPersistence(
  persistence: PersistenceStore,
  key: string,
): Promise<Map<string, PreimageEntry>> {
  try {
    const text = await persistence.readText(key);
    const data: PreimageFileData = JSON.parse(text);
    return new Map(Object.entries(data.entries));
  } catch (error) {
    if (isPersistenceNotFoundError(error)) {
      return new Map();
    }
    throw error;
  }
}

/**
 * Atomically write the entries map through the persistence port.
 */
async function saveToPersistence(
  persistence: PersistenceStore,
  key: string,
  entries: Map<string, PreimageEntry>,
): Promise<void> {
  const data: PreimageFileData = {
    entries: Object.fromEntries(entries),
  };
  const json = JSON.stringify(data, null, 2);
  await persistence.replaceTextAtomically(key, json);
}

/**
 * Create a persistent preimage store backed by a JSON file.
 *
 * Reads existing entries from the file on initialization.
 * Writes atomically (temp file + rename) on every create() and delete().
 */
export function createPersistentPreimageStore(
  filePath: string,
  persistence: PersistenceStore = createFileSystemPersistenceStore(),
): Promise<PreimageStore> {
  return createPersistencePreimageStore(filePath, persistence);
}

export async function createPersistencePreimageStore(
  key: string,
  persistence: PersistenceStore,
): Promise<PreimageStore> {
  const entries = await loadFromPersistence(persistence, key);

  return {
    async create(): Promise<PreimageEntry> {
      const { hash, preimage } = createPreimage();
      const entry: PreimageEntry = {
        hash,
        preimage,
        created_at: Date.now(),
      };
      entries.set(hash, entry);
      await saveToPersistence(persistence, key, entries);
      return entry;
    },

    async getPreimage(hash: string): Promise<string | null> {
      return entries.get(hash)?.preimage ?? null;
    },

    async has(hash: string): Promise<boolean> {
      return entries.has(hash);
    },

    async verify(hash: string, preimage: string): Promise<boolean> {
      const entry = entries.get(hash);
      if (!entry) return false;
      return verifyPreimageHash(preimage, entry.hash);
    },

    async delete(hash: string): Promise<void> {
      entries.delete(hash);
      await saveToPersistence(persistence, key, entries);
    },
  };
}
