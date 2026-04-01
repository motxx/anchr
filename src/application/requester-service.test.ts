import { expect } from "@std/expect";
import { Hono } from "hono";
import { requestOracleHash } from "./requester-service";

// --- Mock oracle server ---

const ORACLE_PORT = 18900 + Math.floor(Math.random() * 100);
const oracleApp = new Hono();
const ORACLE_API_KEY = "test-oracle-key";

oracleApp.post("/hash", (c) => {
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${ORACLE_API_KEY}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json({ hash: "abc123hash" });
});

const abortController = new AbortController();
const server = Deno.serve(
  { port: ORACLE_PORT, signal: abortController.signal, onListen: () => {} },
  oracleApp.fetch,
);

const endpoint = `http://localhost:${ORACLE_PORT}`;

Deno.test({
  name: "requestOracleHash — returns hash from oracle",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await requestOracleHash("q1", endpoint, ORACLE_API_KEY);
    expect(result.hash).toBe("abc123hash");
  },
});

Deno.test({
  name: "requestOracleHash — rejects without API key",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    try {
      await requestOracleHash("q1", endpoint);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Oracle /hash failed: 401");
    }
  },
});

Deno.test({
  name: "requestOracleHash — rejects with wrong API key",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    try {
      await requestOracleHash("q1", endpoint, "wrong-key");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Oracle /hash failed: 401");
    }
  },
});

Deno.test({
  name: "requestOracleHash — throws on unreachable endpoint",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    try {
      await requestOracleHash("q1", "http://localhost:1");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  },
});

// Cleanup
Deno.test({
  name: "requester-service — cleanup",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    abortController.abort();
    await server.finished;
  },
});
