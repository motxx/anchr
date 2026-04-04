/**
 * In-memory listing store for the Verified Data Marketplace.
 * Follows the same pattern as src/domain/query-store.ts.
 */

import type { DataListing } from "./types";

export interface ListingStore {
  get(id: string): DataListing | null;
  set(id: string, listing: DataListing): void;
  list(): DataListing[];
  listActive(): DataListing[];
  delete(id: string): void;
  clear(): void;
}

export function createListingStore(): ListingStore {
  const listings = new Map<string, DataListing>();
  return {
    get: (id) => listings.get(id) ?? null,
    set: (id, listing) => { listings.set(id, listing); },
    list: () => Array.from(listings.values()),
    listActive: () => Array.from(listings.values()).filter((l) => l.active),
    delete: (id) => { listings.delete(id); },
    clear: () => { listings.clear(); },
  };
}
