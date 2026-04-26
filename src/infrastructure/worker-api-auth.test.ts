import { describe, test, beforeEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildWorkerApiApp } from "./worker-api.ts";
import { createQueryService, createQueryStore } from "../application/query-service.ts";
import { createOracleRegistry } from "./oracle/registry.ts";
import type { Oracle, OracleAttestation } from "../../packages/core-domain/src/oracle-types.ts";
import type { Query, QueryResult } from "../../packages/core-domain/src/types.ts";

function makeMockOracle(id: string): Oracle {
  return {
    info: { id, name: `Mock ${id}`, fee_ppm: 0 },
    async verify(query: Query, _result: QueryResult): Promise<OracleAttestation> {
      return { oracle_id: id, query_id: query.id, passed: true, checks: ["ok"], failures: [], attested_at: Date.now() };
    },
  };
}

/**
 * Run a test block with API key auth configured.
 * Sets HTTP_API_KEY for the duration of the callback.
 */
async function withApiKey(key: string, fn: () => Promise<void>): Promise<void> {
  const savedKey = Deno.env.get("HTTP_API_KEY");
  const savedKeys = Deno.env.get("HTTP_API_KEYS");
  Deno.env.set("HTTP_API_KEY", key);
  Deno.env.delete("HTTP_API_KEYS");
  try {
    await fn();
  } finally {
    if (savedKey !== undefined) Deno.env.set("HTTP_API_KEY", savedKey);
    else Deno.env.delete("HTTP_API_KEY");
    if (savedKeys !== undefined) Deno.env.set("HTTP_API_KEYS", savedKeys);
    else Deno.env.delete("HTTP_API_KEYS");
  }
}

function makeTestApp() {
  const store = createQueryStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  registry.register(makeMockOracle("test-oracle"));
  const svc = createQueryService({ store, oracleRegistry: registry });
  const app = buildWorkerApiApp({ queryService: svc, oracleRegistry: registry });
  return { app, svc };
}

describe("writeAuth on /queries/all", () => {
  test("returns 401 without API key when keys are configured", async () => {
    await withApiKey("test-secret-key", async () => {
      const { app } = makeTestApp();
      const res = await app.request("http://localhost/queries/all");
      expect(res.status).toBe(401);
    });
  });

  test("returns 200 with valid API key", async () => {
    await withApiKey("test-secret-key", async () => {
      const { app } = makeTestApp();
      const res = await app.request("http://localhost/queries/all", {
        headers: { "x-api-key": "test-secret-key" },
      });
      expect(res.status).toBe(200);
    });
  });

  test("returns 200 when no keys configured (dev mode)", async () => {
    const savedKey = Deno.env.get("HTTP_API_KEY");
    const savedKeys = Deno.env.get("HTTP_API_KEYS");
    const savedEnv = Deno.env.get("NODE_ENV");
    Deno.env.delete("HTTP_API_KEY");
    Deno.env.delete("HTTP_API_KEYS");
    Deno.env.delete("NODE_ENV");
    try {
      const { app } = makeTestApp();
      const res = await app.request("http://localhost/queries/all");
      expect(res.status).toBe(200);
    } finally {
      if (savedKey !== undefined) Deno.env.set("HTTP_API_KEY", savedKey);
      else Deno.env.delete("HTTP_API_KEY");
      if (savedKeys !== undefined) Deno.env.set("HTTP_API_KEYS", savedKeys);
      else Deno.env.delete("HTTP_API_KEYS");
      if (savedEnv !== undefined) Deno.env.set("NODE_ENV", savedEnv);
      else Deno.env.delete("NODE_ENV");
    }
  });
});

describe("writeAuth on /logs/stream", () => {
  test("returns 401 without API key when keys are configured", async () => {
    await withApiKey("test-secret-key", async () => {
      const { app } = makeTestApp();
      const res = await app.request("http://localhost/logs/stream");
      expect(res.status).toBe(401);
    });
  });

  // Note: testing the authenticated SSE response is skipped because the
  // /logs/stream handler spawns a Docker subprocess that leaks in test.
  // The auth gate itself is verified by the 401 test above.
});

describe("/queries (public) remains unauthenticated", () => {
  test("GET /queries returns 200 without API key", async () => {
    await withApiKey("test-secret-key", async () => {
      const { app } = makeTestApp();
      const res = await app.request("http://localhost/queries");
      expect(res.status).toBe(200);
    });
  });
});
