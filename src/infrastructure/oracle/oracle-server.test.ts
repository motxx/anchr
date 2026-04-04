import { afterAll, beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildOracleApp } from "./oracle-server";
import { createPreimageStore } from "../cashu/preimage-store";
import type { Query, QueryResult } from "../../domain/types";
import { makeQuery as makeBaseQuery } from "../../testing/factories";

const TEST_PORT = 14200 + Math.floor(Math.random() * 100);
const API_KEY = "oracle-test-key";
const baseUrl = `http://localhost:${TEST_PORT}`;

const preimageStore = createPreimageStore();

const makeQuery = (id: string): Query => makeBaseQuery({
  id,
  verification_requirements: ["ai_check"],
  expires_at: Date.now() + 60_000,
});

describe("oracle-server HTLC endpoints", () => {
  let server: Deno.HttpServer;

  beforeAll(() => {
    const app = buildOracleApp({
      oracleId: "test-oracle",
      apiKey: API_KEY,
      preimageStore,
    });
    server = Deno.serve({ port: TEST_PORT, onListen() {} }, app.fetch);
  });

  afterAll(async () => {
    await server.shutdown();
  });

  const authHeaders = (extra?: Record<string, string>) => ({
    "authorization": `Bearer ${API_KEY}`,
    "content-type": "application/json",
    ...extra,
  });

  // --- POST /hash ---

  test("POST /hash creates a new preimage and returns hash", async () => {
    const res = await fetch(`${baseUrl}/hash`, {
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
    const res1 = await fetch(`${baseUrl}/hash`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-hash-idem" }),
    });
    const body1 = await res1.json();

    const res2 = await fetch(`${baseUrl}/hash`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-hash-idem" }),
    });
    const body2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2.hash).toBe(body1.hash);
  });

  test("POST /hash rejects missing query_id", async () => {
    const res = await fetch(`${baseUrl}/hash`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    await res.body?.cancel();
  });

  test("POST /hash rejects without auth", async () => {
    const res = await fetch(`${baseUrl}/hash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query_id: "q-noauth" }),
    });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  // --- GET /hash/:queryId ---

  test("GET /hash/:queryId retrieves existing hash", async () => {
    // First create
    const createRes = await fetch(`${baseUrl}/hash`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-get-hash" }),
    });
    const created = await createRes.json();

    const res = await fetch(`${baseUrl}/hash/q-get-hash`, {
      headers: { "authorization": `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hash).toBe(created.hash);
  });

  test("GET /hash/:queryId returns 404 for unknown query", async () => {
    const res = await fetch(`${baseUrl}/hash/q-unknown`, {
      headers: { "authorization": `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });

  // --- POST /preimage (gated by verification) ---

  test("POST /preimage rejects before verification", async () => {
    // Create a hash first
    const hashRes = await fetch(`${baseUrl}/hash`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-preimage-gate" }),
    });
    await hashRes.json();

    const res = await fetch(`${baseUrl}/preimage`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: "q-preimage-gate" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Verification has not passed");
  });

  test("POST /preimage returns preimage after verification passes", async () => {
    const qid = "q-preimage-ok";

    // 1. Create hash
    const hashRes = await fetch(`${baseUrl}/hash`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: qid }),
    });
    await hashRes.json();

    // 2. Run verification (with minimal query → passes with ai_check)
    const query = makeQuery(qid);
    const result: QueryResult = { attachments: [], notes: "test" };
    const verifyRes = await fetch(`${baseUrl}/verify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query, result }),
    });
    const attestation = await verifyRes.json();
    expect(attestation.passed).toBe(true);

    // 3. Now preimage should be available
    const res = await fetch(`${baseUrl}/preimage`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query_id: qid }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query_id).toBe(qid);
    expect(typeof body.preimage).toBe("string");
    expect(body.preimage.length).toBeGreaterThan(0);
  });

  test("POST /preimage rejects missing query_id", async () => {
    const res = await fetch(`${baseUrl}/preimage`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    await res.body?.cancel();
  });

  // --- X-API-Key header ---

  test("auth accepts X-API-Key header", async () => {
    const res = await fetch(`${baseUrl}/hash`, {
      method: "POST",
      headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ query_id: "q-xapi" }),
    });
    expect(res.status).toBeLessThan(400);
    await res.body?.cancel();
  });
});
