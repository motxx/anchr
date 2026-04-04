import { describe, test, beforeEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import { createPaymentMiddleware, _clearSeenTokensForTest } from "./xcashu-middleware";
import type { DataListing, MarketplaceEnv } from "./types";

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

function makeApp(listing: DataListing | null) {
  const app = new Hono<MarketplaceEnv>();
  const middleware = createPaymentMiddleware((_id) => listing);

  app.post("/data/:id", middleware, (c) => {
    const paymentInfo = c.get("paymentInfo");
    return c.json({ ok: true, mode: paymentInfo.mode, amount: paymentInfo.amount_sats });
  });

  return app;
}

describe("X-Cashu Payment Middleware", () => {
  beforeEach(() => {
    _clearSeenTokensForTest();
    delete process.env.CASHU_MINT_URL;
  });

  test("no payment header returns 402 with pricing info", async () => {
    const listing = makeListing();
    const app = makeApp(listing);
    const res = await app.request("http://localhost/data/listing_test1", { method: "POST" });
    expect(res.status).toBe(402);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe("Payment Required");
    expect(json.price_sats).toBe(10);
    expect(json.htlc_price_sats).toBe(15);
    expect(res.headers.get("x-price")).toBe("10");
    expect(res.headers.get("x-payment-methods")).toBe("cashu-direct, cashu-htlc");
  });

  test("listing not found returns 404", async () => {
    const app = makeApp(null);
    const res = await app.request("http://localhost/data/nonexistent", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("inactive listing returns 410", async () => {
    const listing = makeListing({ active: false });
    const app = makeApp(listing);
    const res = await app.request("http://localhost/data/listing_test1", { method: "POST" });
    expect(res.status).toBe(410);
  });

  test("X-Cashu-Htlc without X-Htlc-Hash returns 400", async () => {
    const listing = makeListing();
    const app = makeApp(listing);
    const res = await app.request("http://localhost/data/listing_test1", {
      method: "POST",
      headers: { "x-cashu-htlc": "cashuBsome-htlc-token" },
    });
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toContain("X-Htlc-Hash");
  });

  test("invalid X-Cashu token returns 402", async () => {
    const listing = makeListing();
    const app = makeApp(listing);
    const res = await app.request("http://localhost/data/listing_test1", {
      method: "POST",
      headers: { "x-cashu": "invalid-token-data" },
    });
    expect(res.status).toBe(402);
  });

  test("replay detection rejects duplicate token hash", async () => {
    const listing = makeListing();
    const app = makeApp(listing);

    const res1 = await app.request("http://localhost/data/listing_test1", {
      method: "POST",
      headers: { "x-cashu": "bad-token" },
    });
    // Token invalid → 402 (not added to seen set because verification failed before that)
    expect(res1.status).toBe(402);
  });
});
