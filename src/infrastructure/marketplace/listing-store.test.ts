import { describe, test, beforeEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createListingStore } from "./listing-store";
import type { DataListing } from "./types";

function makeListing(overrides?: Partial<DataListing>): DataListing {
  return {
    id: "listing_test1",
    name: "BTC Price",
    source_url: "https://api.example.com/btc",
    price_sats: 10,
    htlc_price_sats: 15,
    tlsn_requirement: { target_url: "https://api.example.com/btc" },
    max_age_seconds: 300,
    active: true,
    created_at: Date.now(),
    ...overrides,
  };
}

describe("ListingStore", () => {
  let store: ReturnType<typeof createListingStore>;

  beforeEach(() => {
    store = createListingStore();
  });

  test("get returns null for unknown id", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  test("set and get round-trip", () => {
    const listing = makeListing();
    store.set(listing.id, listing);
    expect(store.get(listing.id)).toEqual(listing);
  });

  test("list returns all listings", () => {
    store.set("a", makeListing({ id: "a" }));
    store.set("b", makeListing({ id: "b", active: false }));
    expect(store.list()).toHaveLength(2);
  });

  test("listActive filters inactive", () => {
    store.set("a", makeListing({ id: "a", active: true }));
    store.set("b", makeListing({ id: "b", active: false }));
    const active = store.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe("a");
  });

  test("delete removes listing", () => {
    const listing = makeListing();
    store.set(listing.id, listing);
    store.delete(listing.id);
    expect(store.get(listing.id)).toBeNull();
  });

  test("clear removes all", () => {
    store.set("a", makeListing({ id: "a" }));
    store.set("b", makeListing({ id: "b" }));
    store.clear();
    expect(store.list()).toHaveLength(0);
  });
});
