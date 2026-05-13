import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import { requestOracleHash } from "./requester-service.ts";

const oracleApp = new Hono();
const ORACLE_API_KEY = "test-oracle-key";

oracleApp.post("/hash", (c) => {
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${ORACLE_API_KEY}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json({ hash: "abc123hash" });
});

const endpoint = "http://oracle.test";
const fetchOracle = async (input: string | URL | Request, init?: RequestInit) =>
  await oracleApp.request(input, init);

describe("requestOracleHash", () => {
  test("returns hash from oracle", async () => {
    const result = await requestOracleHash(
      "q1",
      endpoint,
      ORACLE_API_KEY,
      fetchOracle,
    );
    expect(result.hash).toBe("abc123hash");
  });

  test("rejects without API key", async () => {
    await expect(requestOracleHash("q1", endpoint, undefined, fetchOracle))
      .rejects.toThrow("Oracle /hash failed: 401");
  });

  test("rejects with wrong API key", async () => {
    await expect(requestOracleHash("q1", endpoint, "wrong-key", fetchOracle))
      .rejects.toThrow("Oracle /hash failed: 401");
  });

  test("throws when fetch fails", async () => {
    const failingFetch = () =>
      Promise.reject(new TypeError("connection refused"));
    await expect(requestOracleHash("q1", endpoint, undefined, failingFetch))
      .rejects.toThrow("connection refused");
  });
});
