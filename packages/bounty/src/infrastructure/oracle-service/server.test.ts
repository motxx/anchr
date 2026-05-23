import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildOracleApp } from "./server.ts";
import { createPreimageStore } from "@anchr/sdk/payments";
import type {
  Query,
  QueryResult,
} from "../../../../sdk/src/requests/domain/types.ts";
import { makeQuery as makeBaseQuery } from "../../../../sdk/src/requests/testing/factories.ts";

const API_KEY = "oracle-test-key";

const preimageStore = createPreimageStore();
const app = buildOracleApp({
  oracleId: "test-oracle",
  apiKey: API_KEY,
  preimageStore,
});

const makeQuery = (id: string): Query =>
  makeBaseQuery({
    id,
    verification_requirements: ["ai_check"],
    expires_at: Date.now() + 60_000,
  });

describe("oracle-server HTLC endpoints", () => {
  const authHeaders = (extra?: Record<string, string>) => ({
    "authorization": `Bearer ${API_KEY}`,
    "content-type": "application/json",
    ...extra,
  });

  // --- POST /hash ---

  test("POST /hash creates a new preimage and returns hash", async () => {
    const res = await app.request("/hash", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-hash-1" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.query_id).toBe("q-hash-1");
    expect(typeof body.hash).toBe("string");
    expect(body.hash.length).toBeGreaterThan(0);
  });

  test("POST /hash returns same hash for same query_id (idempotent)", async () => {
    const res1 = await app.request("/hash", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-hash-idem" }),
    });
    const body1 = await res1.json();

    const res2 = await app.request("/hash", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-hash-idem" }),
    });
    const body2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2.hash).toBe(body1.hash);
  });

  test("POST /hash rejects missing query_id", async () => {
    const res = await app.request("/hash", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    await res.body?.cancel();
  });

  test("POST /hash rejects without auth", async () => {
    const res = await app.request("/hash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query_id: "q-noauth" }),
    });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  // --- GET /hash/:queryId ---

  test("GET /hash/:queryId retrieves existing hash", async () => {
    const createRes = await app.request("/hash", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-get-hash" }),
    });
    const created = await createRes.json();

    const res = await app.request("/hash/q-get-hash", {
      headers: { "authorization": `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hash).toBe(created.hash);
  });

  test("GET /hash/:queryId returns 404 for unknown query", async () => {
    const res = await app.request("/hash/q-unknown", {
      headers: { "authorization": `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });

  test("POST /preimage is not exposed as an HTTP fallback", async () => {
    const res = await app.request("/preimage", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-no-http-preimage" }),
    });
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });

  test("GET /hash/:queryId remains available after verification", async () => {
    const qid = "q-hash-after-verify";

    const hashRes = await app.request("/hash", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: qid }),
    });
    const created = await hashRes.json();
    expect(created.hash).toBeTruthy();

    const query = makeQuery(qid);
    const result: QueryResult = { attachments: [], notes: "test" };
    const verifyRes = await app.request("/verify", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query, result }),
    });
    const attestation = await verifyRes.json();
    expect(attestation.passed).toBe(true);

    const getRes = await app.request(`/hash/${qid}`, {
      headers: { "authorization": `Bearer ${API_KEY}` },
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.hash).toBe(created.hash);
  });

  // --- X-API-Key header ---

  test("auth accepts X-API-Key header", async () => {
    const res = await app.request("/hash", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ query_id: "q-xapi" }),
    });
    expect(res.status).toBeLessThan(400);
    await res.body?.cancel();
  });
});
