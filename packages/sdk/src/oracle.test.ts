import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createHttpOracleClient,
  OracleHttpError,
  OracleResponseError,
} from "./oracle.ts";

const ORACLE_PUBKEY = "1234567890abcdef".repeat(4);

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): typeof globalThis.fetch {
  return ((url: string | URL | Request, init?: RequestInit) =>
    impl(typeof url === "string" ? url : url.toString(), init)) as typeof globalThis.fetch;
}

test("createHttpOracleClient returns the hash and oracle pubkey on a 200 response", async () => {
  const fetchImpl = mockFetch(async (url, init) => {
    expect(url).toBe("https://oracle.example.org/hash");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.query_id).toBe("query_123");
    return new Response(JSON.stringify({ hash: "deadbeef" }), { status: 200 });
  });

  const oracle = createHttpOracleClient({
    endpoint: "https://oracle.example.org",
    oraclePubkey: ORACLE_PUBKEY,
    fetchImpl,
  });

  const result = await oracle.requestHash("query_123");
  expect(result.hash).toBe("deadbeef");
  expect(result.oraclePubkey).toBe(ORACLE_PUBKEY);
});

test("createHttpOracleClient strips trailing slashes from the endpoint", async () => {
  let captured = "";
  const fetchImpl = mockFetch(async (url) => {
    captured = url;
    return new Response(JSON.stringify({ hash: "00" }), { status: 200 });
  });

  const oracle = createHttpOracleClient({
    endpoint: "https://oracle.example.org/",
    oraclePubkey: ORACLE_PUBKEY,
    fetchImpl,
  });

  await oracle.requestHash("q");
  expect(captured).toBe("https://oracle.example.org/hash");
});

test("createHttpOracleClient sends the API key as a Bearer header when provided", async () => {
  let auth: string | null = null;
  const fetchImpl = mockFetch(async (_url, init) => {
    const headers = new Headers(init?.headers);
    auth = headers.get("authorization");
    return new Response(JSON.stringify({ hash: "00" }), { status: 200 });
  });

  const oracle = createHttpOracleClient({
    endpoint: "https://oracle.example.org",
    oraclePubkey: ORACLE_PUBKEY,
    apiKey: "secret-token",
    fetchImpl,
  });

  await oracle.requestHash("q");
  expect(auth).toBe("Bearer secret-token");
});

test("createHttpOracleClient throws OracleHttpError on a non-2xx response", async () => {
  const fetchImpl = mockFetch(async () =>
    new Response("internal server error", { status: 500 })
  );

  const oracle = createHttpOracleClient({
    endpoint: "https://oracle.example.org",
    oraclePubkey: ORACLE_PUBKEY,
    fetchImpl,
  });

  await expect(oracle.requestHash("q")).rejects.toThrow(OracleHttpError);
});

test("OracleHttpError carries the status and body for debugging", async () => {
  const fetchImpl = mockFetch(async () => new Response("rate limited", { status: 429 }));

  const oracle = createHttpOracleClient({
    endpoint: "https://oracle.example.org",
    oraclePubkey: ORACLE_PUBKEY,
    fetchImpl,
  });

  try {
    await oracle.requestHash("q");
    throw new Error("should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(OracleHttpError);
    const oracleErr = err as OracleHttpError;
    expect(oracleErr.status).toBe(429);
    expect(oracleErr.body).toBe("rate limited");
  }
});

test("createHttpOracleClient throws OracleResponseError when payload lacks `hash`", async () => {
  const fetchImpl = mockFetch(async () =>
    new Response(JSON.stringify({ result: "ok" }), { status: 200 })
  );

  const oracle = createHttpOracleClient({
    endpoint: "https://oracle.example.org",
    oraclePubkey: ORACLE_PUBKEY,
    fetchImpl,
  });

  await expect(oracle.requestHash("q")).rejects.toThrow(OracleResponseError);
});

test("createHttpOracleClient throws OracleResponseError when `hash` is not a string", async () => {
  const fetchImpl = mockFetch(async () =>
    new Response(JSON.stringify({ hash: 12345 }), { status: 200 })
  );

  const oracle = createHttpOracleClient({
    endpoint: "https://oracle.example.org",
    oraclePubkey: ORACLE_PUBKEY,
    fetchImpl,
  });

  await expect(oracle.requestHash("q")).rejects.toThrow(OracleResponseError);
});
