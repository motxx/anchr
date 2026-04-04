import { describe, test, afterAll, beforeAll } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import { requestOracleHash } from "./requester-service";

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

let server: Deno.HttpServer;
const abortController = new AbortController();

beforeAll(() => {
  server = Deno.serve(
    { port: ORACLE_PORT, signal: abortController.signal, onListen: () => {} },
    oracleApp.fetch,
  );
});

afterAll(async () => {
  abortController.abort();
  await server.finished;
});

const endpoint = `http://localhost:${ORACLE_PORT}`;

describe("requestOracleHash", () => {
  test("returns hash from oracle", async () => {
    const result = await requestOracleHash("q1", endpoint, ORACLE_API_KEY);
    expect(result.hash).toBe("abc123hash");
  });

  test("rejects without API key", async () => {
    await expect(requestOracleHash("q1", endpoint)).rejects.toThrow("Oracle /hash failed: 401");
  });

  test("rejects with wrong API key", async () => {
    await expect(requestOracleHash("q1", endpoint, "wrong-key")).rejects.toThrow("Oracle /hash failed: 401");
  });

  test("throws on unreachable endpoint", async () => {
    await expect(requestOracleHash("q1", "http://localhost:1")).rejects.toThrow();
  });
});
