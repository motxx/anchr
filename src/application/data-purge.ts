/**
 * Data purge: completely delete expired query data from memory.
 *
 * Privacy guarantee: once a query expires, all traces are removed.
 * Blossom blob cleanup is handled server-side.
 */

import { purgeExpiredFromStore } from "./query-service";

/**
 * Purge all expired queries from the in-memory store.
 * Returns number of queries purged.
 */
export async function purgeExpiredQueries(): Promise<number> {
  const expired = purgeExpiredFromStore();
  return expired.length;
}
