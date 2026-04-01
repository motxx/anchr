import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createPreimageStore } from "../oracle/preimage-store";
import { createOracleRegistry } from "../oracle/registry";
import type { Oracle, OracleAttestation } from "../oracle/types";
import { createQueryService, createQueryStore } from "../application/query-service";
import type { Query, QueryResult } from "../domain/types";
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

  test("POST /queries succeeds without htlc field", withOpenAuth(async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "No HTLC" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { id: string; status: string };
    expect(json.status).toBe("pending");
  }));

  test("POST /queries creates an HTLC query via injected service", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "Test Store status check",
        htlc: { hash: "abc123", oracle_pubkey: "opub", requester_pubkey: "rpub", locktime: Math.floor(Date.now() / 1000) + 3600 },
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { query_id: string; description: string; status: string; htlc: { hash: string } };
    expect(json.query_id).toMatch(/^query_/);
    expect(json.description).toBe("Test Store status check");
    expect(json.status).toBe("awaiting_quotes");
    expect(json.htlc.hash).toBe("abc123");
    expect(queryService.getQuery(json.query_id)).not.toBeNull();
  }));

  test("GET /queries/:id returns query detail", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "Test query" });
    const res = await app.request(`http://localhost/queries/${query.id}`);
    expect(res.status).toBe(200);
    const json = await res.json() as { id: string; status: string; description: string };
    expect(json.id).toBe(query.id);
    expect(json.status).toBe("pending");
    expect(json.description).toBe("Test query");
  }));

  test("GET /queries/:id returns 404 for unknown query", async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/queries/nonexistent");
    expect(res.status).toBe(404);
  });

  test("POST /queries/:id/submit returns 410 (deprecated)", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "Test query" });
    const res = await app.request(`http://localhost/queries/${query.id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attachments: [], notes: "open" }),
    });
    expect(res.status).toBe(410);
    const json = await res.json() as { error: string; hint: string };
    expect(json.error).toBe("Deprecated");
    expect(json.hint).toContain("HTLC");
  }));

  test("POST /queries/:id/cancel cancels via injected service", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "Test query" });
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
    queryService.createQuery({ description: "Active" }, { ttlMs: 60_000 });
    queryService.createQuery({ description: "Expired" }, { ttlMs: -1 });
    const res = await app.request("http://localhost/queries");
    expect(res.status).toBe(200);
    const json = await res.json() as Array<{ id: string }>;
    expect(json).toHaveLength(1);
  }));

  test("isolated app instances do not share state", withOpenAuth(async () => {
    const { app: app1, queryService: qs1 } = makeTestApp();
    const { app: app2 } = makeTestApp();
    const query = qs1.createQuery({ description: "Only in app1" });

    const res1 = await app1.request(`http://localhost/queries/${query.id}`);
    expect(res1.status).toBe(200);

    const res2 = await app2.request(`http://localhost/queries/${query.id}`);
    expect(res2.status).toBe(404);
  }));
});

describe("HTLC endpoints", () => {
  const htlcInfo = {
    hash: "abcd1234",
    oracle_pubkey: "oracle_pub",
    requester_pubkey: "requester_pub",
    locktime: Math.floor(Date.now() / 1000) + 3600,
  };

  test("POST /queries creates HTLC query when htlc provided", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "HTLC query",
        htlc: htlcInfo,
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { query_id: string; status: string; payment_status: string; htlc: { hash: string } | null };
    expect(json.status).toBe("awaiting_quotes");
    expect(json.payment_status).toBe("htlc_locked");
    expect(json.htlc?.hash).toBe("abcd1234");
    expect(queryService.getQuery(json.query_id)?.htlc).toBeDefined();
  }));

  test("GET /queries/:id/quotes returns quotes", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "HTLC" }, { htlc: htlcInfo });
    queryService.recordQuote(query.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });

    const res = await app.request(`http://localhost/queries/${query.id}/quotes`);
    expect(res.status).toBe(200);
    const json = await res.json() as Array<{ worker_pubkey: string }>;
    expect(json).toHaveLength(1);
    expect(json[0]!.worker_pubkey).toBe("w1");
  }));

  test("POST /queries/:id/quotes records a quote", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "HTLC" }, { htlc: htlcInfo });

    const res = await app.request(`http://localhost/queries/${query.id}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w1", amount_sats: 100, quote_event_id: "evt_1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(queryService.getQuery(query.id)?.quotes).toHaveLength(1);
  }));

  test("POST /queries/:id/select selects worker", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "HTLC" }, { htlc: htlcInfo });

    const res = await app.request(`http://localhost/queries/${query.id}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w1", htlc_token: "token123" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(queryService.getQuery(query.id)?.status).toBe("processing");
  }));

  test("POST /queries/:id/result for HTLC does inline verification", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "HTLC" }, { htlc: htlcInfo, oracleIds: ["test-oracle"] });
    await queryService.selectWorker(query.id, "w1");

    const res = await app.request(`http://localhost/queries/${query.id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w1", attachments: [], notes: "done", oracle_id: "test-oracle" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; oracle_id: string; payment_status: string; preimage: string | null };
    expect(json.ok).toBe(true);
    expect(json.oracle_id).toBe("test-oracle");
    expect(json.payment_status).toBe("released");
    // No preimage store configured in basic test
    expect(json.preimage).toBeNull();
    expect(queryService.getQuery(query.id)?.status).toBe("approved");
  }));

  test("GET /queries/:id includes HTLC info", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "HTLC" }, { htlc: htlcInfo });

    const res = await app.request(`http://localhost/queries/${query.id}`);
    expect(res.status).toBe(200);
    const json = await res.json() as { status: string; payment_status: string };
    expect(json.status).toBe("awaiting_quotes");
    expect(json.payment_status).toBe("htlc_locked");
  }));

  test("HTLC full lifecycle via HTTP (inline verification)", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();

    // Create HTLC query
    const createRes = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Full HTLC lifecycle", htlc: htlcInfo, oracle_ids: ["test-oracle"] }),
    });
    expect(createRes.status).toBe(201);
    const { query_id } = await createRes.json() as { query_id: string };

    // Submit quote
    const quoteRes = await app.request(`http://localhost/queries/${query_id}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w1", amount_sats: 100, quote_event_id: "e1" }),
    });
    expect((await quoteRes.json() as { ok: boolean }).ok).toBe(true);

    // Select worker
    const selectRes = await app.request(`http://localhost/queries/${query_id}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w1", htlc_token: "final_token" }),
    });
    expect((await selectRes.json() as { ok: boolean }).ok).toBe(true);

    // Submit result — now does inline verification for HTLC queries
    const resultRes = await app.request(`http://localhost/queries/${query_id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w1", attachments: [], notes: "photo", oracle_id: "test-oracle" }),
    });
    const resultJson = await resultRes.json() as { ok: boolean; oracle_id: string; payment_status: string };
    expect(resultJson.ok).toBe(true);
    expect(resultJson.oracle_id).toBe("test-oracle");
    expect(resultJson.payment_status).toBe("released");
    expect(queryService.getQuery(query_id)?.status).toBe("approved");
  }));
});

describe("POST /hash", () => {
  function makeTestAppWithPreimage() {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle = makeMockOracle("test-oracle");
    registry.register(oracle);
    const preimageStore = createPreimageStore();
    const queryService = createQueryService({ store, oracleRegistry: registry, preimageStore });
    const app = buildWorkerApiApp({ queryService, oracleRegistry: registry, preimageStore });
    return { app, store, registry, queryService, preimageStore };
  }

  test("generates hash", withOpenAuth(async () => {
    const { app } = makeTestAppWithPreimage();
    const res = await app.request("http://localhost/hash", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json() as { hash: string };
    expect(json.hash).toBeTruthy();
  }));

  test("each call generates a unique hash", withOpenAuth(async () => {
    const { app } = makeTestAppWithPreimage();
    const res1 = await app.request("http://localhost/hash", { method: "POST" });
    const res2 = await app.request("http://localhost/hash", { method: "POST" });
    const json1 = await res1.json() as { hash: string };
    const json2 = await res2.json() as { hash: string };
    expect(json1.hash).not.toBe(json2.hash);
  }));
});

describe("HTLC inline verification with preimage", () => {
  function makeTestAppWithPreimage() {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle = makeMockOracle("test-oracle");
    registry.register(oracle);
    const preimageStore = createPreimageStore();
    const queryService = createQueryService({ store, oracleRegistry: registry, preimageStore });
    const app = buildWorkerApiApp({ queryService, oracleRegistry: registry, preimageStore });
    return { app, store, registry, queryService, preimageStore };
  }

  test("POST /queries/:id/result returns preimage for HTLC on success", withOpenAuth(async () => {
    const { app, queryService, preimageStore } = makeTestAppWithPreimage();
    // Generate hash first, then create query with it
    const entry = preimageStore.create();
    const htlcInfo = {
      hash: entry.hash,
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };
    const query = queryService.createQuery({ description: "HTLC" }, { htlc: htlcInfo, oracleIds: ["test-oracle"] });
    await queryService.selectWorker(query.id, "w1");

    const res = await app.request(`http://localhost/queries/${query.id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w1", attachments: [], notes: "done", oracle_id: "test-oracle" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; preimage: string | null; oracle_id: string };
    expect(json.ok).toBe(true);
    expect(json.preimage).toBe(entry.preimage);
    expect(json.oracle_id).toBe("test-oracle");
  }));

  test("full HTLC lifecycle with POST /hash", withOpenAuth(async () => {
    const { app, preimageStore } = makeTestAppWithPreimage();

    // 1. Generate hash via API
    const hashRes = await app.request("http://localhost/hash", { method: "POST" });
    expect(hashRes.status).toBe(200);
    const { hash } = await hashRes.json() as { hash: string };
    expect(hash).toBeTruthy();

    // Verify preimage was stored keyed by hash
    expect(preimageStore.has(hash)).toBe(true);
    expect(preimageStore.getPreimage(hash)).toBeTruthy();
  }));
});

describe("Quorum via HTTP", () => {
  function makeMockOracleWithPass(id: string, pass: boolean): Oracle {
    return {
      info: { id, name: `Mock ${id}`, fee_ppm: 0 },
      async verify(query: Query, _result: QueryResult): Promise<OracleAttestation> {
        return {
          oracle_id: id,
          query_id: query.id,
          passed: pass,
          checks: pass ? ["mock passed"] : [],
          failures: pass ? [] : ["mock failed"],
          attested_at: Date.now(),
        };
      },
    };
  }

  test("POST /queries creates query with quorum config", withOpenAuth(async () => {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    registry.register(makeMockOracleWithPass("oracle-a", true));
    registry.register(makeMockOracleWithPass("oracle-b", true));
    const queryService = createQueryService({ store, oracleRegistry: registry });
    const app = buildWorkerApiApp({ queryService, oracleRegistry: registry });

    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "Quorum query",
        oracle_ids: ["oracle-a", "oracle-b"],
        quorum: { min_approvals: 2 },
        htlc: { hash: "qhash", oracle_pubkey: "opub", requester_pubkey: "rpub", locktime: Math.floor(Date.now() / 1000) + 3600 },
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { query_id: string };
    const query = queryService.getQuery(json.query_id);
    expect(query?.quorum).toEqual({ min_approvals: 2 });
  }));

  test("GET /queries/:id exposes quorum and attestations", withOpenAuth(async () => {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    registry.register(makeMockOracleWithPass("oracle-a", true));
    registry.register(makeMockOracleWithPass("oracle-b", true));
    const queryService = createQueryService({ store, oracleRegistry: registry });
    const app = buildWorkerApiApp({ queryService, oracleRegistry: registry });

    const query = queryService.createQuery(
      { description: "Quorum test" },
      { oracleIds: ["oracle-a", "oracle-b"], quorum: { min_approvals: 2 } },
    );
    await queryService.submitQueryResult(
      query.id,
      { attachments: [], notes: "test" },
      { executor_type: "human", channel: "worker_api" },
    );

    const res = await app.request(`http://localhost/queries/${query.id}`);
    expect(res.status).toBe(200);
    const json = await res.json() as { quorum: { min_approvals: number }; attestations: Array<{ oracle_id: string; passed: boolean }> };
    expect(json.quorum).toEqual({ min_approvals: 2 });
    expect(json.attestations).toHaveLength(2);
    expect(json.attestations.every((a) => a.passed)).toBe(true);
  }));
});
