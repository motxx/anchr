/**
 * Data purge: completely delete expired query data from memory.
 *
 * Privacy guarantee: once a query expires, all traces are removed.
 * Blossom blob cleanup is handled server-side.
 */

import type { QueryService } from "./query-service.ts";

/**
 * Purge all expired queries from the in-memory store.
 * Returns number of queries purged.
 */
export async function purgeExpiredQueries(service: QueryService): Promise<number> {
  const expired = service.purgeExpiredFromStore();
  return expired.length;
}
