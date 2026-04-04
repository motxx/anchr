import { afterAll, beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildOracleApp } from "./oracle-server";
import { createHttpOracle } from "./http-oracle";
import type { Query, QueryResult } from "../../domain/types";
import { makeQuery as makeBaseQuery } from "../../testing/factories";

const TEST_ORACLE_ID = "test-http-oracle";
const TEST_API_KEY = "test-secret";
const TEST_PORT = 14000 + Math.floor(Math.random() * 1000);

const makeQuery = (id: string): Query => makeBaseQuery({
  id,
  description: "Test Store status check",
  challenge_nonce: "nonce",
  challenge_rule: "rule",
  verification_requirements: ["ai_check"],
  expires_at: Date.now() + 60_000,
});

const baseUrl = `http://localhost:${TEST_PORT}`;

describe("http-oracle", () => {
  let server: Deno.HttpServer;

  beforeAll(() => {
    const app = buildOracleApp(TEST_ORACLE_ID, TEST_API_KEY);
    server = Deno.serve({ port: TEST_PORT, onListen() {} }, app.fetch);
  });

  afterAll(async () => {
    await server.shutdown();
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
      body: JSON.stringify({ query: makeQuery("q1"), result: { attachments: [], notes: "open" } }),
    });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  test("oracle server verify with valid auth", async () => {
    const query = makeQuery("q2");
    const result: QueryResult = { attachments: [], notes: "open" };

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
    const result: QueryResult = { attachments: [], notes: "closed" };
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
    const result: QueryResult = { attachments: [], notes: "open" };

    await expect(oracle.verify(query, result)).rejects.toThrow(/401/);
  });
});
