import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createPreimageStore } from "@anchr/core-cashu/preimage-store";
import { createOracleRegistry } from "./oracle-client/registry.ts";
import type { Oracle, OracleAttestation } from "../domain/oracle-types.ts";
import { createQueryService, createQueryStore } from "../application/query-service.ts";
import type { Query, QueryResult } from "../domain/types.ts";
import { buildWorkerApiApp } from "./worker-api.ts";

function makeMockOracle(id: string, pass = true): Oracle {
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

function makeTestAppWithOracle(opts: { pass?: boolean; oracleId?: string } = {}) {
  const id = opts.oracleId ?? "test-oracle";
  const store = createQueryStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  registry.register(makeMockOracle(id, opts.pass ?? true));
  const queryService = createQueryService({ store, oracleRegistry: registry });
  const app = buildWorkerApiApp({ queryService, oracleRegistry: registry });
  return { app, store, registry, queryService };
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
    const savedKey = Deno.env.get("HTTP_API_KEY");
    const savedKeys = Deno.env.get("HTTP_API_KEYS");
    Deno.env.delete("HTTP_API_KEY");
    Deno.env.delete("HTTP_API_KEYS");
    try {
      await fn();
    } finally {
      if (savedKey !== undefined) Deno.env.set("HTTP_API_KEY", savedKey);
      else Deno.env.delete("HTTP_API_KEY");
      if (savedKeys !== undefined) Deno.env.set("HTTP_API_KEYS", savedKeys);
      else Deno.env.delete("HTTP_API_KEYS");
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
        escrow: { type: "htlc", hash: "abc123", oracle_pubkeys: ["opub"], requester_pubkey: "rpub", locktime: Math.floor(Date.now() / 1000) + 3600 },
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { query_id: string; description: string; status: string; escrow: { hash: string } };
    expect(json.query_id).toMatch(/^query_/);
    expect(json.description).toBe("Test Store status check");
    expect(json.status).toBe("awaiting_quotes");
    expect(json.escrow.hash).toBe("abc123");
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
  const escrowInfo = {
    type: "htlc" as const,
    hash: "abcd1234",
    oracle_pubkeys: ["oracle_pub"],
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
        escrow: escrowInfo,
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { query_id: string; status: string; payment_status: string; escrow: { hash: string } | null };
    expect(json.status).toBe("awaiting_quotes");
    expect(json.payment_status).toBe("escrow_locked");
    expect(json.escrow?.hash).toBe("abcd1234");
    expect(queryService.getQuery(json.query_id)?.escrow).toBeDefined();
  }));

  test("GET /queries/:id/quotes returns quotes", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "HTLC" }, { escrow: escrowInfo });
    queryService.recordQuote(query.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });

    const res = await app.request(`http://localhost/queries/${query.id}/quotes`);
    expect(res.status).toBe(200);
    const json = await res.json() as Array<{ worker_pubkey: string }>;
    expect(json).toHaveLength(1);
    expect(json[0]!.worker_pubkey).toBe("w1");
  }));

  test("POST /queries/:id/quotes records a quote", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "HTLC" }, { escrow: escrowInfo });

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
    const query = queryService.createQuery({ description: "HTLC" }, { escrow: escrowInfo });

    const res = await app.request(`http://localhost/queries/${query.id}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w1", htlc_token: "token123" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(queryService.getQuery(query.id)?.status).toBe("worker_selected");
  }));

  test("POST /queries/:id/result for HTLC does inline verification", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "HTLC" }, { escrow: escrowInfo, oracleIds: ["test-oracle"] });
    await queryService.selectWorker(query.id, "w1");
    queryService.beginWork(query.id);

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
    const query = queryService.createQuery({ description: "HTLC" }, { escrow: escrowInfo });

    const res = await app.request(`http://localhost/queries/${query.id}`);
    expect(res.status).toBe(200);
    const json = await res.json() as { status: string; payment_status: string };
    expect(json.status).toBe("awaiting_quotes");
    expect(json.payment_status).toBe("escrow_locked");
  }));

  test("HTLC full lifecycle via HTTP (inline verification)", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();

    // Create HTLC query
    const createRes = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Full HTLC lifecycle", escrow: escrowInfo, oracle_ids: ["test-oracle"] }),
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

    // Begin work (worker_selected → processing)
    const beginRes = await app.request(`http://localhost/queries/${query_id}/begin`, {
      method: "POST",
    });
    expect((await beginRes.json() as { ok: boolean }).ok).toBe(true);

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

describe("P2PK+FROST escrow endpoints", () => {
  // Smaller surface than HTLC: settlement is a threshold signature delivered
  // out-of-band by the FROST coordinator (see packages/frost-oracle),
  // so the Query API today only exercises wire-shape round-tripping for the
  // FROST variant. These tests lock down the discriminated-union side of the
  // schema so HTLC and P2PK+FROST stay distinguishable on the wire.
  const frostEscrow = {
    type: "p2pk_frost" as const,
    group_pubkey: "f".repeat(64),
    oracle_pubkeys: ["frost_signer_a", "frost_signer_b", "frost_signer_c"],
    requester_pubkey: "requester_pub",
    locktime: Math.floor(Date.now() / 1000) + 3600,
  };

  test("POST /queries accepts a p2pk_frost escrow", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "FROST query",
        escrow: frostEscrow,
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as {
      query_id: string;
      status: string;
      payment_status: string;
      escrow: { type: string; group_pubkey?: string; hash?: string } | null;
    };
    expect(json.status).toBe("awaiting_quotes");
    expect(json.payment_status).toBe("escrow_locked");
    expect(json.escrow?.type).toBe("p2pk_frost");
    expect(json.escrow?.group_pubkey).toBe("f".repeat(64));
    expect(json.escrow?.hash).toBeUndefined();

    const stored = queryService.getQuery(json.query_id);
    expect(stored?.escrow?.type).toBe("p2pk_frost");
    if (stored?.escrow?.type === "p2pk_frost") {
      expect(stored.escrow.group_pubkey).toBe("f".repeat(64));
      expect(stored.escrow.oracle_pubkeys).toHaveLength(3);
    }
  }));

  test("GET /queries/:id round-trips the p2pk_frost discriminator", withOpenAuth(async () => {
    const { app, queryService } = makeTestApp();
    const query = queryService.createQuery({ description: "FROST detail" }, { escrow: frostEscrow });
    const res = await app.request(`http://localhost/queries/${query.id}`);
    expect(res.status).toBe(200);
    const json = await res.json() as { escrow: { type: string; group_pubkey?: string; hash?: string } | null };
    expect(json.escrow?.type).toBe("p2pk_frost");
    expect(json.escrow?.group_pubkey).toBe("f".repeat(64));
    expect(json.escrow?.hash).toBeUndefined();
  }));

  test("POST /queries rejects a p2pk_frost escrow missing group_pubkey", withOpenAuth(async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "FROST without group_pubkey",
        escrow: {
          type: "p2pk_frost",
          // group_pubkey deliberately omitted
          oracle_pubkeys: ["a", "b"],
          requester_pubkey: "r",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
      }),
    });
    expect(res.status).toBe(400);
  }));

  test("POST /queries rejects an htlc escrow missing hash", withOpenAuth(async () => {
    const { app } = makeTestApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "HTLC without hash",
        escrow: {
          type: "htlc",
          // hash deliberately omitted
          oracle_pubkeys: ["a"],
          requester_pubkey: "r",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
      }),
    });
    expect(res.status).toBe(400);
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
    const escrowInfo = {
      type: "htlc" as const,
      hash: entry.hash,
      oracle_pubkeys: ["oracle_pub"],
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };
    const query = queryService.createQuery({ description: "HTLC" }, { escrow: escrowInfo, oracleIds: ["test-oracle"] });
    await queryService.selectWorker(query.id, "w1");
    queryService.beginWork(query.id);

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
  test("POST /queries creates query with quorum config", withOpenAuth(async () => {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    registry.register(makeMockOracle("oracle-a"));
    registry.register(makeMockOracle("oracle-b"));
    const queryService = createQueryService({ store, oracleRegistry: registry });
    const app = buildWorkerApiApp({ queryService, oracleRegistry: registry });

    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "Quorum query",
        oracle_ids: ["oracle-a", "oracle-b"],
        quorum: { min_approvals: 2 },
        escrow: { type: "htlc", hash: "qhash", oracle_pubkeys: ["opub"], requester_pubkey: "rpub", locktime: Math.floor(Date.now() / 1000) + 3600 },
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
    registry.register(makeMockOracle("oracle-a"));
    registry.register(makeMockOracle("oracle-b"));
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

describe("End-to-end HTTP integration", () => {
  // Domain-level integration: HTTP → Service → Aggregate → Repository.
  // Covers paths the per-endpoint suites above don't isolate: oracle
  // rejection, expiry, double-submit, and validation surface.

  test("POST /queries/:id/result with rejecting oracle → 400", withOpenAuth(async () => {
    const { app } = makeTestAppWithOracle({ pass: false, oracleId: "built-in" });
    const createRes = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Photo" }),
    });
    const { query_id: id } = await createRes.json() as { query_id: string };
    const res = await app.request(`http://localhost/queries/${id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "test_worker", attachments: [], notes: "Proof" }),
    });
    expect(res.status).toBe(400);
    const result = await res.json() as { ok: boolean; payment_status: string };
    expect(result.ok).toBe(false);
    expect(result.payment_status).toBe("cancelled");
  }));

  test("POST /queries/:id/result on expired query → fails", withOpenAuth(async () => {
    const { app, queryService } = makeTestAppWithOracle();
    const query = queryService.createQuery({ description: "Quick expiry" }, { ttlMs: -1 });
    queryService.expireQueries();
    const res = await app.request(`http://localhost/queries/${query.id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w", attachments: [] }),
    });
    const result = await res.json() as { ok: boolean };
    expect(result.ok).toBe(false);
  }));

  test("POST /queries/:id/cancel on already-approved → fails", withOpenAuth(async () => {
    const { app, queryService } = makeTestAppWithOracle();
    const query = queryService.createQuery({ description: "Approve then cancel" }, { oracleIds: ["test-oracle"] });
    await queryService.submitQueryResult(query.id, { attachments: [], notes: "" }, { executor_type: "human", channel: "worker_api" });
    const cancelRes = await app.request(`http://localhost/queries/${query.id}/cancel`, { method: "POST" });
    const body = await cancelRes.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  }));

  test("double submit to the same query → second call fails", withOpenAuth(async () => {
    const { app, queryService } = makeTestAppWithOracle();
    const query = queryService.createQuery({ description: "Double submit" }, { oracleIds: ["test-oracle"] });
    const submit = () => app.request(`http://localhost/queries/${query.id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w", attachments: [] }),
    });
    expect((await (await submit()).json() as { ok: boolean }).ok).toBe(true);
    expect((await (await submit()).json() as { ok: boolean }).ok).toBe(false);
  }));

  test("POST /queries/:id/result on non-existent query → fails", withOpenAuth(async () => {
    const { app } = makeTestAppWithOracle();
    const res = await app.request("http://localhost/queries/fake-id/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker_pubkey: "w", attachments: [] }),
    });
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  }));

  test("POST /queries supports verification_requirements + nonce challenge", withOpenAuth(async () => {
    const { app } = makeTestAppWithOracle();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "GPS query",
        verification_requirements: ["gps", "nonce"],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { verification_requirements: string[]; challenge_nonce: string };
    expect(body.verification_requirements).toContain("gps");
    expect(body.verification_requirements).toContain("nonce");
    expect(body.challenge_nonce).toBeDefined();
  }));

  test("POST /queries supports expected_gps + max_gps_distance_km", withOpenAuth(async () => {
    const { app } = makeTestAppWithOracle();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "GPS query",
        expected_gps: { lat: 35.6762, lon: 139.6503 },
        max_gps_distance_km: 5,
      }),
    });
    expect(res.status).toBe(201);
  }));

  test("POST /queries supports bounty payload", withOpenAuth(async () => {
    const { app } = makeTestAppWithOracle();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "Bounty query",
        bounty: { amount_sats: 100 },
      }),
    });
    expect(res.status).toBe(201);
  }));
});
