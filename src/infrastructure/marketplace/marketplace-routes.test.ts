import { describe, test, beforeEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildWorkerApiApp } from "../worker-api";
import { createListingStore } from "./listing-store";
import { createOracleRegistry } from "../oracle/registry";
import { createQueryService, createQueryStore } from "../../application/query-service";
import type { Oracle, OracleAttestation } from "../../domain/oracle-types";
import type { Query, QueryResult } from "../../domain/types";
import { _clearSeenTokensForTest } from "./xcashu-middleware";
import { _clearPurchaseLogForTest } from "./marketplace-routes";
import { _clearCacheForTest } from "./data-fetcher";

function makeMockOracle(id: string): Oracle {
  return {
    info: { id, name: `Mock ${id}`, fee_ppm: 0 },
    async verify(query: Query, _result: QueryResult): Promise<OracleAttestation> {
      return {
        oracle_id: id,
        query_id: query.id,
        passed: true,
        checks: ["mock passed"],
        failures: [],
        attested_at: Date.now(),
      };
    },
  };
}

function makeTestApp() {
  const queryStore = createQueryStore();
  const listingStore = createListingStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  registry.register(makeMockOracle("test-oracle"));
  const queryService = createQueryService({ store: queryStore, oracleRegistry: registry });
  const app = buildWorkerApiApp({ queryService, oracleRegistry: registry, listingStore });
  return { app, listingStore };
}

function withOpenAuth(fn: () => Promise<void>) {
  return async () => {
    const savedKey = process.env.HTTP_API_KEY;
    const savedKeys = process.env.HTTP_API_KEYS;
    delete process.env.HTTP_API_KEY;
    delete process.env.HTTP_API_KEYS;
    try {
      await fn();
    } finally {
      if (savedKey !== undefined) process.env.HTTP_API_KEY = savedKey;
      else delete process.env.HTTP_API_KEY;
      if (savedKeys !== undefined) process.env.HTTP_API_KEYS = savedKeys;
      else delete process.env.HTTP_API_KEYS;
    }
  };
}

describe("Marketplace Routes", () => {
  beforeEach(() => {
    _clearSeenTokensForTest();
    _clearPurchaseLogForTest();
    _clearCacheForTest();
  });

  test("GET /marketplace/listings returns empty when no listings", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/marketplace/listings");
    expect(res.status).toBe(200);
    const json = await res.json() as unknown[];
    expect(json).toHaveLength(0);
  });

  test("POST /marketplace/listings creates a listing", withOpenAuth(async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/marketplace/listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "BTC Price",
        source_url: "https://api.example.com/btc",
        price_sats: 10,
        htlc_price_sats: 15,
        tlsn_requirement: { target_url: "https://api.example.com/btc" },
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { id: string; name: string; active: boolean };
    expect(json.name).toBe("BTC Price");
    expect(json.active).toBe(true);
    expect(json.id).toMatch(/^listing_/);
  }));

  test("created listing appears in GET /marketplace/listings", withOpenAuth(async () => {
    const { app } = makeTestApp();
    await app.request("http://localhost/marketplace/listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "ETH Price",
        source_url: "https://api.example.com/eth",
        price_sats: 5,
        htlc_price_sats: 8,
        tlsn_requirement: { target_url: "https://api.example.com/eth" },
      }),
    });
    const listRes = await app.request("http://localhost/marketplace/listings");
    expect(listRes.status).toBe(200);
    const listings = await listRes.json() as Array<{ name: string }>;
    expect(listings).toHaveLength(1);
    expect(listings[0]!.name).toBe("ETH Price");
  }));

  test("GET /marketplace/listings/:id returns 404 for unknown", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/marketplace/listings/nonexistent");
    expect(res.status).toBe(404);
  });

  test("DELETE /marketplace/listings/:id deactivates listing", withOpenAuth(async () => {
    const { app, listingStore } = makeTestApp();
    // Create listing directly in store
    listingStore.set("listing_del", {
      id: "listing_del",
      name: "To Delete",
      source_url: "https://example.com",
      price_sats: 10,
      htlc_price_sats: 15,
      tlsn_requirement: { target_url: "https://example.com" },
      max_age_seconds: 300,
      active: true,
      created_at: Date.now(),
    });

    const res = await app.request("http://localhost/marketplace/listings/listing_del", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; active: boolean };
    expect(json.ok).toBe(true);
    expect(json.active).toBe(false);

    // Verify it's no longer in active list
    const listRes = await app.request("http://localhost/marketplace/listings");
    const listings = await listRes.json() as unknown[];
    expect(listings).toHaveLength(0);
  }));

  test("GET /marketplace/data/:id returns 402", async () => {
    const { app, listingStore } = makeTestApp();
    listingStore.set("listing_402", {
      id: "listing_402",
      name: "402 Test",
      source_url: "https://example.com",
      price_sats: 10,
      htlc_price_sats: 15,
      tlsn_requirement: { target_url: "https://example.com" },
      max_age_seconds: 300,
      active: true,
      created_at: Date.now(),
    });

    const res = await app.request("http://localhost/marketplace/data/listing_402");
    expect(res.status).toBe(402);
    const json = await res.json() as { listing_id: string; price_sats: number };
    expect(json.listing_id).toBe("listing_402");
    expect(json.price_sats).toBe(10);
  });

  test("GET /marketplace/data/:id returns 404 for unknown", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/marketplace/data/nonexistent");
    expect(res.status).toBe(404);
  });

  test("POST /marketplace/data/:id without payment returns 402", async () => {
    const { app, listingStore } = makeTestApp();
    listingStore.set("listing_nopay", {
      id: "listing_nopay",
      name: "No Pay Test",
      source_url: "https://example.com",
      price_sats: 10,
      htlc_price_sats: 15,
      tlsn_requirement: { target_url: "https://example.com" },
      max_age_seconds: 300,
      active: true,
      created_at: Date.now(),
    });

    const res = await app.request("http://localhost/marketplace/data/listing_nopay", {
      method: "POST",
    });
    expect(res.status).toBe(402);
  });

  test("POST /marketplace/listings with invalid payload returns 400", withOpenAuth(async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/marketplace/listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }), // name too short, missing required fields
    });
    expect(res.status).toBe(400);
  }));

  test("existing /queries routes still work", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/queries");
    expect(res.status).toBe(200);
    const json = await res.json() as unknown[];
    expect(json).toHaveLength(0);
  });

  test("existing /health route still works", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/health");
    expect(res.status).toBe(200);
  });
});
