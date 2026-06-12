/**
 * Bounded replay-detection set: remembers keys (presentation hashes) long
 * enough to refuse a replay, while evicting by age and by a hard entry cap
 * so a long-running Oracle cannot be memory-exhausted through submissions.
 *
 * Retention must stay at or above the largest attestation max-age the host
 * accepts — once an entry ages out, the freshness check is what rejects the
 * replayed proof.
 */

export interface ReplayGuardOptions {
  /** How long a key is remembered. Default: 7 days. */
  retentionMs?: number;
  /** Hard cap on remembered keys; oldest are evicted first. Default: 100k. */
  maxEntries?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

export interface ReplayGuard {
  has(key: string): boolean;
  add(key: string): void;
  clear(): void;
  size(): number;
}

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100_000;

export function createReplayGuard(
  options: ReplayGuardOptions = {},
): ReplayGuard {
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  // Insertion-ordered: oldest entries sit at the front.
  const seen = new Map<string, number>();

  function evict(): void {
    const cutoff = now() - retentionMs;
    for (const [key, insertedAt] of seen) {
      if (insertedAt >= cutoff) break;
      seen.delete(key);
    }
    while (seen.size > maxEntries) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }

  return {
    has(key) {
      evict();
      return seen.has(key);
    },
    add(key) {
      seen.set(key, now());
      evict();
    },
    clear() {
      seen.clear();
    },
    size() {
      return seen.size;
    },
  };
}
