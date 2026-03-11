import { describe, expect, test } from "bun:test";
import { createOracleRegistry } from "./oracle/registry";
import type { Oracle, OracleAttestation } from "./oracle/types";
import { createQueryService, createQueryStore } from "./query-service";
import type { Query, QueryResult } from "./types";
import { buildWorkerApiApp } from "./worker-api";

function makeMockOracle(id: string): Oracle {
  return {
    info: { id, name: `Mock ${id}`, fee_ppm: 0 },
    async verify(query: Query, _result: QueryResult): Promise<OracleAttestation> {
      return {
        oracle_id: id,
        query_id: query.id,
        passed: true,
        checks: ["mock passed"],
        failures: [],
        attested_at: Date.now(),
      };
    },
  };
}

function makeTestApp() {
  const store = createQueryStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  const oracle = makeMockOracle("test-oracle");
  registry.register(oracle);
  const queryService = createQueryService({ store, oracleRegistry: registry });
  const app = buildWorkerApiApp({ queryService, oracleRegistry: registry });
  return { app, store, registry, queryService };
}

function withOpenAuth(fn: () => Promise<void>) {
  return async () => {
    const savedKey = process.env.HTTP_API_KEY;
    const savedKeys = process.env.HTTP_API_KEYS;
    delete process.env.HTTP_API_KEY;
    delete process.env.HTTP_API_KEYS;
    try {
      await fn();
    } finally {
      if (savedKey !== undefined) process.env.HTTP_API_KEY = savedKey;
      else delete process.env.HTTP_API_KEY;
      if (savedKeys !== undefined) process.env.HTTP_API_KEYS = savedKeys;
      else delete process.env.HTTP_API_KEYS;
    }
  };
}

describe("buildWorkerApiApp with injected deps", () => {
  test("GET /health returns ok", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/health");
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  test("GET /oracles lists injected oracles", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/oracles");
    expect(res.status).toBe(200);
    const json = await res.json() as Array<{ id: string }>;
    expect(json).toHaveLength(1);
    expect(json[0]!.id).toBe("test-oracle");
  });

  test("GET /queries returns empty when no queries created", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/queries");
    expect(res.status).toBe(200);
    const json = await res.json() as unknown[];
    expect(json).toHaveLength(0);
  });

  test("POST /queries creates a query via injected service", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "store_status", store_name: "Test Store" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { query_id: string; type: string; status: string };
    expect(json.query_id).toStartWith("query_");
    expect(json.type).toBe("store_status");
    expect(json.status).toBe("pending");
    expect(queryService.getQuery(json.query_id)).not.toBeNull();
  }));

  test("GET /queries/:id returns query detail", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ type: "store_status", store_name: "Test" });
    const res = await app.request(`http://localhost/queries/${query.id}`);
    expect(res.status).toBe(200);
    const json = await res.json() as { id: string; status: string; type: string };
    expect(json.id).toBe(query.id);
    expect(json.status).toBe("pending");
    expect(json.type).toBe("store_status");
  }));

  test("GET /queries/:id returns 404 for unknown query", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/queries/nonexistent");
    expect(res.status).toBe(404);
  });

  test("POST /queries/:id/submit verifies with injected oracle", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ type: "store_status", store_name: "Test" });
    const res = await app.request(`http://localhost/queries/${query.id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "store_status",
        status: "open",
        oracle_id: "test-oracle",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; oracle_id: string; payment_status: string };
    expect(json.ok).toBe(true);
    expect(json.oracle_id).toBe("test-oracle");
    expect(json.payment_status).toBe("released");
  }));

  test("POST /queries/:id/cancel cancels via injected service", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ type: "store_status", store_name: "Test" });
    const res = await app.request(`http://localhost/queries/${query.id}/cancel`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(queryService.getQuery(query.id)?.status).toBe("rejected");
  }));

  test("GET /queries lists only open queries from injected service", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    queryService.createQuery({ type: "store_status", store_name: "Active" }, { ttlMs: 60_000 });
    queryService.createQuery({ type: "store_status", store_name: "Expired" }, { ttlMs: -1 });
    const res = await app.request("http://localhost/queries");
    expect(res.status).toBe(200);
    const json = await res.json() as Array<{ id: string }>;
    expect(json).toHaveLength(1);
  }));

  test("isolated app instances do not share state", withOpenAuth(async () => {
    const { app: app1, queryService: qs1 } = makeTestApp();
    const { app: app2 } = makeTestApp();
    const query = qs1.createQuery({ type: "store_status", store_name: "Only in app1" });

    const res1 = await app1.request(`http://localhost/queries/${query.id}`);
    expect(res1.status).toBe(200);

    const res2 = await app2.request(`http://localhost/queries/${query.id}`);
    expect(res2.status).toBe(404);
  }));
});
