import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildMarketApiRoutes } from "./market-api-routes.ts";
import { _setFrostSignerPathForTest } from "../../../src/infrastructure/frost/frost-cli.ts";

// Ensure we're in single-key mode for these tests
_setFrostSignerPathForTest(null);

function createTestApp() {
  return buildMarketApiRoutes({ apiKey: undefined });
}

test("GET /health returns ok", async () => {
  const { app } = createTestApp();
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.mode).toBe("single-key");
});

test("GET /info shows single-key mode", async () => {
  const { app } = createTestApp();
  const res = await app.request("/info");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.mode).toBe("single-key");
  expect(body.frost).toBeNull();
});

test("POST /markets creates a market with keys", async () => {
  const { app } = createTestApp();
  const res = await app.request("/markets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "test-market-1",
      title: "Will BTC hit $200K?",
      resolution_url: "https://api.example.com/price",
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: "https://api.example.com/price",
        jsonpath: "price",
        threshold: 200000,
        description: "BTC > $200K",
      },
    }),
  });

  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.market_id).toBe("test-market-1");
  expect(body.group_pubkey_yes).toBeTruthy();
  expect(body.group_pubkey_no).toBeTruthy();
  expect(body.group_pubkey_yes).not.toBe(body.group_pubkey_no);
  expect(body.htlc_hash_yes).toBeTruthy();
  expect(body.htlc_hash_no).toBeTruthy();
  expect(body.mode).toBe("single-key");
});

test("GET /markets/:id returns created market", async () => {
  const { app } = createTestApp();

  // Create market
  await app.request("/markets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "m-1", title: "Test" }),
  });

  // Fetch it
  const res = await app.request("/markets/m-1");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.id).toBe("m-1");
  expect(body.status).toBe("open");
  expect(body.group_pubkey_yes).toBeTruthy();
  expect(body.group_pubkey_no).toBeTruthy();
});

test("GET /markets/:id returns 404 for unknown market", async () => {
  const { app } = createTestApp();
  const res = await app.request("/markets/nonexistent");
  expect(res.status).toBe(404);
});

test("POST /markets/:id/resolve resolves YES when condition met", async () => {
  const { app } = createTestApp();

  // Create market with price_above condition
  await app.request("/markets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "resolve-yes",
      title: "Price above 100?",
      resolution_url: "https://api.example.com/price",
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: "https://api.example.com/price",
        jsonpath: "price",
        threshold: 100,
        description: "price > 100",
      },
    }),
  });

  // Resolve with price = 200 (above threshold)
  const res = await app.request("/markets/resolve-yes/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      verified_body: JSON.stringify({ price: 200 }),
      server_name: "api.example.com",
    }),
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.resolution.outcome).toBe("yes");
  expect(body.resolution.oracle_signature).toBeTruthy();
  expect(body.mode).toBe("single-key");
});

test("POST /markets/:id/resolve resolves NO when condition not met", async () => {
  const { app } = createTestApp();

  await app.request("/markets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "resolve-no",
      title: "Price above 100?",
      resolution_url: "https://api.example.com/price",
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: "https://api.example.com/price",
        jsonpath: "price",
        threshold: 100,
        description: "price > 100",
      },
    }),
  });

  // Resolve with price = 50 (below threshold)
  const res = await app.request("/markets/resolve-no/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      verified_body: JSON.stringify({ price: 50 }),
    }),
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.resolution.outcome).toBe("no");
});

test("POST /markets/:id/resolve returns 404 for unknown market", async () => {
  const { app } = createTestApp();
  const res = await app.request("/markets/nonexistent/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified_body: "{}" }),
  });
  expect(res.status).toBe(404);
});

test("POST /markets/:id/resolve returns 409 for already resolved market", async () => {
  const { app } = createTestApp();

  await app.request("/markets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "double-resolve",
      title: "Test",
      resolution_url: "https://api.example.com/price",
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: "https://api.example.com/price",
        jsonpath: "price",
        threshold: 100,
        description: "price > 100",
      },
    }),
  });

  // First resolve
  await app.request("/markets/double-resolve/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified_body: JSON.stringify({ price: 200 }) }),
  });

  // Second resolve should fail
  const res = await app.request("/markets/double-resolve/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified_body: JSON.stringify({ price: 200 }) }),
  });
  expect(res.status).toBe(409);
});

test("FROST market signer round1 returns 503 when FROST not configured", async () => {
  const { app } = createTestApp();
  const res = await app.request("/frost/market/signer/round1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "deadbeef",
      market_id: "m-1",
      outcome: "yes",
      condition_data: {
        resolution_condition: { type: "contains_text", target_url: "", expected_text: "yes", description: "" },
        verified_body: "yes",
      },
    }),
  });
  expect(res.status).toBe(503);
});
