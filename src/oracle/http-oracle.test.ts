import { expect, test, afterAll } from "bun:test";
import { buildOracleApp } from "./oracle-server";
import { createHttpOracle } from "./http-oracle";
import type { Query, QueryResult } from "../types";

const TEST_ORACLE_ID = "test-http-oracle";
const TEST_API_KEY = "test-secret";
const TEST_PORT = 14000 + Math.floor(Math.random() * 1000);

const app = buildOracleApp(TEST_ORACLE_ID, TEST_API_KEY);
const server = Bun.serve({ port: TEST_PORT, fetch: app.fetch });
afterAll(() => server.stop());

const baseUrl = `http://localhost:${TEST_PORT}`;

const makeQuery = (id: string, type: "store_status" = "store_status"): Query => ({
  id,
  type,
  status: "pending",
  params: { type: "store_status", store_name: "Test Store" },
  challenge_nonce: "nonce",
  challenge_rule: "rule",
  created_at: Date.now(),
  expires_at: Date.now() + 60_000,
  payment_status: "locked",
});

// --- Oracle server tests ---

test("oracle server health endpoint", async () => {
  const res = await fetch(`${baseUrl}/health`);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.oracle_id).toBe(TEST_ORACLE_ID);
});

test("oracle server info endpoint", async () => {
  const res = await fetch(`${baseUrl}/info`);
  const body = await res.json();
  expect(body.id).toBe(TEST_ORACLE_ID);
});

test("oracle server rejects unauthenticated verify", async () => {
  const res = await fetch(`${baseUrl}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: makeQuery("q1"), result: { type: "store_status", status: "open" } }),
  });
  expect(res.status).toBe(401);
});

test("oracle server verify with valid auth", async () => {
  const query = makeQuery("q2");
  const result: QueryResult = { type: "store_status", status: "open" };

  const res = await fetch(`${baseUrl}/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${TEST_API_KEY}`,
    },
    body: JSON.stringify({ query, result }),
  });

  expect(res.status).toBe(200);
  const attestation = await res.json();
  expect(attestation.oracle_id).toBe(TEST_ORACLE_ID);
  expect(attestation.query_id).toBe("q2");
  expect(attestation.passed).toBe(true);
  expect(attestation.checks.length).toBeGreaterThan(0);
});

test("oracle server verify rejects bad store status", async () => {
  const query = makeQuery("q3");
  const result = { type: "store_status", status: "maybe" } as unknown as QueryResult;

  const res = await fetch(`${baseUrl}/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${TEST_API_KEY}`,
    },
    body: JSON.stringify({ query, result }),
  });

  expect(res.status).toBe(200);
  const attestation = await res.json();
  expect(attestation.passed).toBe(false);
  expect(attestation.failures.length).toBeGreaterThan(0);
});

// --- HTTP oracle client tests ---

test("createHttpOracle delegates to remote server", async () => {
  const oracle = createHttpOracle({
    id: TEST_ORACLE_ID,
    name: "Test Oracle",
    endpoint: baseUrl,
    fee_ppm: 50_000,
    apiKey: TEST_API_KEY,
  });

  expect(oracle.info.id).toBe(TEST_ORACLE_ID);
  expect(oracle.info.endpoint).toBe(baseUrl);

  const query = makeQuery("q4");
  const result: QueryResult = { type: "store_status", status: "closed" };
  const attestation = await oracle.verify(query, result);

  expect(attestation.oracle_id).toBe(TEST_ORACLE_ID);
  expect(attestation.query_id).toBe("q4");
  expect(attestation.passed).toBe(true);
});

test("createHttpOracle fails without auth", async () => {
  const oracle = createHttpOracle({
    id: TEST_ORACLE_ID,
    name: "Test Oracle",
    endpoint: baseUrl,
    fee_ppm: 0,
    // no apiKey
  });

  const query = makeQuery("q5");
  const result: QueryResult = { type: "store_status", status: "open" };

  await expect(oracle.verify(query, result)).rejects.toThrow(/401/);
});
