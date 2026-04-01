import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildWorkerApiApp } from "./worker-api";
import { createQueryService, createQueryStore } from "../application/query-service";
import type { QueryService } from "../application/query-service";
import { createOracleRegistry } from "../oracle";
import type { Oracle, OracleAttestation } from "../oracle";
import type { Query, QueryResult, BlossomKeyMap } from "../domain/types";

// --- Mock oracle ---

function makeMockOracle(pass = true, id = "built-in"): Oracle {
  return {
    info: { id, name: `Mock ${id}`, version: "1.0" },
    verify: async (_q: Query, _r: QueryResult, _k?: BlossomKeyMap): Promise<OracleAttestation> => ({
      oracle_id: id,
      passed: pass,
      checks: pass ? ["Check passed"] : [],
      failures: pass ? [] : ["Check failed"],
      attested_at: Date.now(),
    }),
  };
}

// --- Full-stack app factory ---

function makeApp(oraclePass = true) {
  const store = createQueryStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  registry.register(makeMockOracle(oraclePass));
  const svc = createQueryService({ store, oracleRegistry: registry });
  // Ensure no API key required for tests
  const savedKey = process.env.HTTP_API_KEY;
  const savedKeys = process.env.HTTP_API_KEYS;
  delete process.env.HTTP_API_KEY;
  delete process.env.HTTP_API_KEYS;

  const app = buildWorkerApiApp({ queryService: svc });

  return {
    app,
    svc,
    cleanup: () => {
      if (savedKey !== undefined) process.env.HTTP_API_KEY = savedKey;
      else delete process.env.HTTP_API_KEY;
      if (savedKeys !== undefined) process.env.HTTP_API_KEYS = savedKeys;
      else delete process.env.HTTP_API_KEYS;
    },
  };
}

async function createQueryViaHttp(app: ReturnType<typeof buildWorkerApiApp>, body: Record<string, unknown>) {
  return app.request("/queries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function submitResultViaHttp(
  app: ReturnType<typeof buildWorkerApiApp>,
  id: string,
  body: Record<string, unknown>,
) {
  return app.request(`/queries/${id}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- Tests ---

describe("Domain integration: HTTP → Service → Aggregate → Repository", () => {
  test("POST /queries → 201 and GET /queries/:id confirms", async () => {
    const { app, cleanup } = makeApp();
    try {
      const createRes = await createQueryViaHttp(app, {
        description: "Take a photo of Tokyo Tower",
      });
      expect(createRes.status).toBe(201);
      const body = await createRes.json() as Record<string, unknown>;
      expect(body.query_id).toBeDefined();
      expect(body.status).toBe("pending");

      const getRes = await app.request(`/queries/${body.query_id}`, { method: "GET" });
      expect(getRes.status).toBe(200);
      const detail = await getRes.json() as Record<string, unknown>;
      expect(detail.id).toBe(body.query_id);
      expect(detail.status).toBe("pending");
    } finally {
      cleanup();
    }
  });

  test("POST /queries/:id/result (valid) → approved", async () => {
    const { app, cleanup } = makeApp(true);
    try {
      const createRes = await createQueryViaHttp(app, { description: "Photo" });
      const { query_id: id } = await createRes.json() as { query_id: string };

      const submitRes = await submitResultViaHttp(app, id, {
        worker_pubkey: "test_worker",
        attachments: [],
        notes: "Proof",
      });
      expect(submitRes.status).toBe(200);
      const result = await submitRes.json() as { ok: boolean; payment_status: string };
      expect(result.ok).toBe(true);
      expect(result.payment_status).toBe("released");
    } finally {
      cleanup();
    }
  });

  test("POST /queries/:id/result (rejected) → 400", async () => {
    const { app, cleanup } = makeApp(false);
    try {
      const createRes = await createQueryViaHttp(app, { description: "Photo" });
      const { query_id: id } = await createRes.json() as { query_id: string };

      const submitRes = await submitResultViaHttp(app, id, {
        worker_pubkey: "test_worker",
        attachments: [],
      });
      expect(submitRes.status).toBe(400);
      const result = await submitRes.json() as { ok: boolean; payment_status: string };
      expect(result.ok).toBe(false);
      expect(result.payment_status).toBe("cancelled");
    } finally {
      cleanup();
    }
  });

  test("GET /queries/:id for non-existent → 404", async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await app.request("/queries/no-such-id", { method: "GET" });
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });

  test("POST /queries/:id/result on expired query → error", async () => {
    const { app, svc, cleanup } = makeApp(true);
    try {
      const createRes = await createQueryViaHttp(app, {
        description: "Quick expiry",
        ttl_seconds: 0,
      });
      const { query_id: id } = await createRes.json() as { query_id: string };

      await new Promise((r) => setTimeout(r, 5));
      svc.expireQueries();

      const submitRes = await submitResultViaHttp(app, id, {
        worker_pubkey: "w",
        attachments: [],
      });
      // Should fail — query is expired
      const result = await submitRes.json() as { ok: boolean };
      expect(result.ok).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("POST /queries/:id/cancel → cancels pending query", async () => {
    const { app, cleanup } = makeApp();
    try {
      const createRes = await createQueryViaHttp(app, { description: "Cancel me" });
      const { query_id: id } = await createRes.json() as { query_id: string };

      const cancelRes = await app.request(`/queries/${id}/cancel`, { method: "POST" });
      expect(cancelRes.status).toBe(200);
      const body = await cancelRes.json() as { ok: boolean };
      expect(body.ok).toBe(true);

      const getRes = await app.request(`/queries/${id}`, { method: "GET" });
      const detail = await getRes.json() as { status: string };
      expect(detail.status).toBe("rejected");
    } finally {
      cleanup();
    }
  });

  test("POST /queries/:id/cancel on already approved → fails", async () => {
    const { app, cleanup } = makeApp(true);
    try {
      const createRes = await createQueryViaHttp(app, { description: "Approve then cancel" });
      const { query_id: id } = await createRes.json() as { query_id: string };

      await submitResultViaHttp(app, id, {
        worker_pubkey: "w",
        attachments: [],
      });

      const cancelRes = await app.request(`/queries/${id}/cancel`, { method: "POST" });
      const body = await cancelRes.json() as { ok: boolean };
      expect(body.ok).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("GET /queries lists open queries", async () => {
    const { app, cleanup } = makeApp();
    try {
      await createQueryViaHttp(app, { description: "Query 1" });
      await createQueryViaHttp(app, { description: "Query 2" });

      const listRes = await app.request("/queries", { method: "GET" });
      expect(listRes.status).toBe(200);
      const body = await listRes.json() as unknown[];
      expect(body.length).toBe(2);
    } finally {
      cleanup();
    }
  });

  test("POST /queries with verification_requirements including nonce", async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await createQueryViaHttp(app, {
        description: "GPS query",
        verification_requirements: ["gps", "nonce"],
      });
      expect(res.status).toBe(201);
      const body = await res.json() as {
        verification_requirements: string[];
        challenge_nonce: string;
      };
      expect(body.verification_requirements).toContain("gps");
      expect(body.verification_requirements).toContain("nonce");
      expect(body.challenge_nonce).toBeDefined();
    } finally {
      cleanup();
    }
  });

  test("POST /queries with expected_gps", async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await createQueryViaHttp(app, {
        description: "GPS query",
        expected_gps: { lat: 35.6762, lon: 139.6503 },
        max_gps_distance_km: 5,
      });
      expect(res.status).toBe(201);
    } finally {
      cleanup();
    }
  });

  test("POST /queries with bounty", async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await createQueryViaHttp(app, {
        description: "Bounty query",
        bounty: { amount_sats: 100 },
      });
      expect(res.status).toBe(201);
    } finally {
      cleanup();
    }
  });

  test("POST /queries/:id/result on non-existent query → error", async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await submitResultViaHttp(app, "fake-id", {
        worker_pubkey: "w",
        attachments: [],
      });
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("double submit to same query → second fails", async () => {
    const { app, cleanup } = makeApp(true);
    try {
      const createRes = await createQueryViaHttp(app, { description: "Double submit" });
      const { query_id: id } = await createRes.json() as { query_id: string };

      const first = await submitResultViaHttp(app, id, {
        worker_pubkey: "w",
        attachments: [],
      });
      const firstBody = await first.json() as { ok: boolean };
      expect(firstBody.ok).toBe(true);

      const second = await submitResultViaHttp(app, id, {
        worker_pubkey: "w",
        attachments: [],
      });
      const secondBody = await second.json() as { ok: boolean };
      expect(secondBody.ok).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("GET /oracles returns oracle list", async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await app.request("/oracles", { method: "GET" });
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(body.length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  test("GET /health returns ok", async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await app.request("/health", { method: "GET" });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("Domain integration: HTLC lifecycle via HTTP", () => {
  test("create HTLC query and verify state via HTTP", async () => {
    const { app, svc, cleanup } = makeApp(true);
    try {
      const nowSecs = Math.floor(Date.now() / 1000);
      const createRes = await createQueryViaHttp(app, {
        description: "HTLC query",
        htlc: {
          hash: "abc123",
          oracle_pubkey: "oracle_pub",
          requester_pubkey: "req_pub",
          locktime: nowSecs + 1200,
        },
        bounty: { amount_sats: 50 },
      });
      expect(createRes.status).toBe(201);
      const { query_id: id } = await createRes.json() as { query_id: string; status: string };

      // Verify via HTTP
      const getRes = await app.request(`/queries/${id}`, { method: "GET" });
      expect(getRes.status).toBe(200);
      const detail = await getRes.json() as { status: string; htlc: unknown };
      expect(detail.status).toBe("awaiting_quotes");
      expect(detail.htlc).toBeDefined();
    } finally {
      cleanup();
    }
  });

  test("full HTLC lifecycle: HTTP create → service quote/select → HTTP result", async () => {
    const { app, svc, cleanup } = makeApp(true);
    try {
      const nowSecs = Math.floor(Date.now() / 1000);
      const createRes = await createQueryViaHttp(app, {
        description: "HTLC flow",
        htlc: {
          hash: "h123",
          oracle_pubkey: "o",
          requester_pubkey: "r",
          locktime: nowSecs + 1200,
        },
      });
      const { query_id: id } = await createRes.json() as { query_id: string };

      // Quote + select via service (these are service-level operations)
      svc.recordQuote(id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
      await svc.selectWorker(id, "w1");

      // Submit result via HTTP
      const submitRes = await submitResultViaHttp(app, id, {
        worker_pubkey: "w1",
        attachments: [],
      });
      expect(submitRes.status).toBe(200);
      const result = await submitRes.json() as { ok: boolean; payment_status: string };
      expect(result.ok).toBe(true);
      expect(result.payment_status).toBe("released");

      // Verify final state
      const getRes = await app.request(`/queries/${id}`, { method: "GET" });
      const detail = await getRes.json() as { status: string };
      expect(detail.status).toBe("approved");
    } finally {
      cleanup();
    }
  });

  test("HTLC query quote via HTTP", async () => {
    const { app, cleanup } = makeApp();
    try {
      const nowSecs = Math.floor(Date.now() / 1000);
      const createRes = await createQueryViaHttp(app, {
        description: "Quote test",
        htlc: {
          hash: "h",
          oracle_pubkey: "o",
          requester_pubkey: "r",
          locktime: nowSecs + 1200,
        },
      });
      const { query_id: id } = await createRes.json() as { query_id: string };

      // Submit quote via HTTP
      const quoteRes = await app.request(`/queries/${id}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worker_pubkey: "w1",
          quote_event_id: "evt1",
        }),
      });
      expect(quoteRes.status).toBe(200);
      const quoteBody = await quoteRes.json() as { ok: boolean };
      expect(quoteBody.ok).toBe(true);

      // Verify quotes via HTTP
      const quotesRes = await app.request(`/queries/${id}/quotes`, { method: "GET" });
      const quotes = await quotesRes.json() as unknown[];
      expect(quotes.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  test("HTLC query visible in GET /queries list", async () => {
    const { app, cleanup } = makeApp();
    try {
      const nowSecs = Math.floor(Date.now() / 1000);
      await createQueryViaHttp(app, {
        description: "HTLC listed",
        htlc: {
          hash: "h",
          oracle_pubkey: "o",
          requester_pubkey: "r",
          locktime: nowSecs + 1200,
        },
      });

      const listRes = await app.request("/queries", { method: "GET" });
      const body = await listRes.json() as { status: string }[];
      expect(body.some((q) => q.status === "awaiting_quotes")).toBe(true);
    } finally {
      cleanup();
    }
  });
});
