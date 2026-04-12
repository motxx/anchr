/**
 * Dual-preimage store for conditional swaps.
 *
 * Wraps PreimageStore to manage two preimage/hash pairs per swap — one for
 * each binary outcome (A/B). On reveal, the winning preimage is returned
 * and the losing one is permanently deleted.
 */

import {
  createPreimageStore,
  type PreimageStore,
  type PreimageEntry,
} from "../preimage/preimage-store.ts";

export interface DualPreimageEntry {
  swap_id: string;
  hash_a: string;
  hash_b: string;
  created_at: number;
}

export interface DualPreimageStore {
  /** Generate a preimage pair for a new swap. Returns both hashes. */
  create(swap_id: string): { hash_a: string; hash_b: string };
  /** Reveal the winning preimage. Deletes the losing one (irreversible). */
  reveal(swap_id: string, outcome: "a" | "b"): string | null;
  /** Get the public hashes for a swap. */
  getHashes(swap_id: string): { hash_a: string; hash_b: string } | null;
  /** Check whether a swap exists. */
  has(swap_id: string): boolean;
}

interface SwapEntries {
  entry_a: PreimageEntry;
  entry_b: PreimageEntry;
  revealed: boolean;
}

export function createDualPreimageStore(
  backing?: PreimageStore,
): DualPreimageStore {
  const store = backing ?? createPreimageStore();
  const swaps = new Map<string, SwapEntries>();

  return {
    create(swap_id: string): { hash_a: string; hash_b: string } {
      const existing = swaps.get(swap_id);
      if (existing) {
        return { hash_a: existing.entry_a.hash, hash_b: existing.entry_b.hash };
      }

      const entry_a = store.create();
      const entry_b = store.create();
      swaps.set(swap_id, { entry_a, entry_b, revealed: false });

      return { hash_a: entry_a.hash, hash_b: entry_b.hash };
    },

    reveal(swap_id: string, outcome: "a" | "b"): string | null {
      const entry = swaps.get(swap_id);
      if (!entry || entry.revealed) return null;

      entry.revealed = true;

      const winner = outcome === "a" ? entry.entry_a : entry.entry_b;
      const loser = outcome === "a" ? entry.entry_b : entry.entry_a;

      // Get the winning preimage before any deletions
      const preimage = store.getPreimage(winner.hash);

      // Permanently delete the losing preimage — irreversible
      store.delete(loser.hash);

      return preimage;
    },

    getHashes(swap_id: string): { hash_a: string; hash_b: string } | null {
      const entry = swaps.get(swap_id);
      if (!entry) return null;
      return { hash_a: entry.entry_a.hash, hash_b: entry.entry_b.hash };
    },

    has(swap_id: string): boolean {
      return swaps.has(swap_id);
    },
  };
}
