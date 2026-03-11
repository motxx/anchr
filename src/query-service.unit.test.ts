import { describe, expect, test } from "bun:test";
import {
  createOracleRegistry,
} from "./oracle/registry";
import type { Oracle, OracleAttestation } from "./oracle/types";
import {
  createQueryService,
  createQueryStore,
} from "./query-service";
import type { Query, QueryResult } from "./types";
import { createIntegrityStore } from "./verification/integrity-store";

function makeMockOracle(id: string, passFn?: (query: Query, result: QueryResult) => boolean): Oracle {
  return {
    info: { id, name: `Mock ${id}`, fee_ppm: 0 },
    async verify(query: Query, result: QueryResult): Promise<OracleAttestation> {
      const passed = passFn ? passFn(query, result) : true;
      return {
        oracle_id: id,
        query_id: query.id,
        passed,
        checks: passed ? ["mock check passed"] : [],
        failures: passed ? [] : ["mock check failed"],
        attested_at: Date.now(),
      };
    },
  };
}

describe("createQueryStore", () => {
  test("stores and retrieves queries", () => {
    const store = createQueryStore();
    const query = { id: "q1" } as Query;
    store.set("q1", query);
    expect(store.get("q1")).toBe(query);
  });

  test("returns null for unknown id", () => {
    const store = createQueryStore();
    expect(store.get("unknown")).toBeNull();
  });

  test("lists all values", () => {
    const store = createQueryStore();
    store.set("a", { id: "a" } as Query);
    store.set("b", { id: "b" } as Query);
    expect(store.values()).toHaveLength(2);
  });

  test("deletes entries", () => {
    const store = createQueryStore();
    store.set("a", { id: "a" } as Query);
    store.delete("a");
    expect(store.get("a")).toBeNull();
  });

  test("clears all entries", () => {
    const store = createQueryStore();
    store.set("a", { id: "a" } as Query);
    store.set("b", { id: "b" } as Query);
    store.clear();
    expect(store.values()).toHaveLength(0);
  });

  test("instances are isolated", () => {
    const store1 = createQueryStore();
    const store2 = createQueryStore();
    store1.set("a", { id: "a" } as Query);
    expect(store2.get("a")).toBeNull();
  });
});

describe("createQueryService", () => {
  function makeIsolatedService(opts?: {
    mockOracle?: Oracle;
    hooks?: { onCreated?: (q: Query) => void };
  }) {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle = opts?.mockOracle ?? makeMockOracle("test-oracle");
    registry.register(oracle);
    return {
      service: createQueryService({
        store,
        oracleRegistry: registry,
        hooks: opts?.hooks,
      }),
      store,
      registry,
      oracle,
    };
  }

  test("createQuery returns a pending query with nonce", () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ type: "store_status", store_name: "Test" });
    expect(query.status).toBe("pending");
    expect(query.challenge_nonce).toBeTruthy();
    expect(query.id).toStartWith("query_");
  });

  test("createQuery respects ttlMs option", () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { type: "store_status", store_name: "Test" },
      { ttlMs: 5000 },
    );
    expect(query.expires_at - query.created_at).toBe(5000);
  });

  test("createQuery respects ttlSeconds option", () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { type: "store_status", store_name: "Test" },
      { ttlSeconds: 120 },
    );
    expect(query.expires_at - query.created_at).toBe(120_000);
  });

  test("createQuery stores requester_meta", () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { type: "store_status", store_name: "Test" },
      { requesterMeta: { requester_type: "app", requester_id: "test-app" } },
    );
    expect(query.requester_meta?.requester_type).toBe("app");
    expect(query.requester_meta?.requester_id).toBe("test-app");
  });

  test("createQuery stores oracle_ids", () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { type: "store_status", store_name: "Test" },
      { oracleIds: ["oracle-a", "oracle-b"] },
    );
    expect(query.oracle_ids).toEqual(["oracle-a", "oracle-b"]);
  });

  test("createQuery stores bounty info", () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { type: "store_status", store_name: "Test" },
      { bounty: { amount_sats: 100 } },
    );
    expect(query.bounty?.amount_sats).toBe(100);
  });

  test("createQuery fires onCreated hook", () => {
    const created: Query[] = [];
    const { service } = makeIsolatedService({
      hooks: { onCreated: (q) => created.push(q) },
    });
    service.createQuery({ type: "store_status", store_name: "Test" });
    expect(created).toHaveLength(1);
  });

  test("getQuery retrieves created query", () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ type: "store_status", store_name: "Test" });
    expect(service.getQuery(query.id)).toEqual(query);
  });

  test("getQuery returns null for unknown id", () => {
    const { service } = makeIsolatedService();
    expect(service.getQuery("nonexistent")).toBeNull();
  });

  test("listOpenQueries returns only pending non-expired queries", () => {
    const { service } = makeIsolatedService();
    service.createQuery({ type: "store_status", store_name: "Active" }, { ttlMs: 60_000 });
    service.createQuery({ type: "store_status", store_name: "Expired" }, { ttlMs: -1 });
    const open = service.listOpenQueries();
    expect(open).toHaveLength(1);
    expect(open[0]!.params).toEqual({ type: "store_status", store_name: "Active" });
  });

  test("submitQueryResult approves valid submission", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ type: "store_status", store_name: "Test" });
    const outcome = await service.submitQueryResult(
      query.id,
      { type: "store_status", status: "open" },
      { executor_type: "human", channel: "worker_api" },
      "test-oracle",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.payment_status).toBe("released");
    expect(outcome.query?.assigned_oracle_id).toBe("test-oracle");
  });

  test("submitQueryResult rejects when oracle fails verification", async () => {
    const { service } = makeIsolatedService({
      mockOracle: makeMockOracle("strict-oracle", () => false),
    });
    const query = service.createQuery({ type: "store_status", store_name: "Test" });
    const outcome = await service.submitQueryResult(
      query.id,
      { type: "store_status", status: "open" },
      { executor_type: "human", channel: "worker_api" },
      "strict-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.query?.status).toBe("rejected");
    expect(outcome.query?.payment_status).toBe("cancelled");
  });

  test("submitQueryResult fails for nonexistent query", async () => {
    const { service } = makeIsolatedService();
    const outcome = await service.submitQueryResult(
      "nonexistent",
      { type: "store_status", status: "open" },
      { executor_type: "human", channel: "worker_api" },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.query).toBeNull();
    expect(outcome.message).toBe("Query not found");
  });

  test("submitQueryResult fails for expired query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { type: "store_status", store_name: "Test" },
      { ttlMs: -1 },
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { type: "store_status", status: "open" },
      { executor_type: "human", channel: "worker_api" },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe("Query has expired");
  });

  test("submitQueryResult fails for already-submitted query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ type: "store_status", store_name: "Test" });
    await service.submitQueryResult(
      query.id,
      { type: "store_status", status: "open" },
      { executor_type: "human", channel: "worker_api" },
      "test-oracle",
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { type: "store_status", status: "open" },
      { executor_type: "human", channel: "worker_api" },
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not pending");
  });

  test("submitQueryResult rejects unacceptable oracle", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { type: "store_status", store_name: "Test" },
      { oracleIds: ["specific-oracle"] },
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { type: "store_status", status: "open" },
      { executor_type: "human", channel: "worker_api" },
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not available or not accepted");
  });

  test("cancelQuery cancels a pending query", () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ type: "store_status", store_name: "Test" });
    const outcome = service.cancelQuery(query.id);
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("rejected");
    expect(service.getQuery(query.id)?.payment_status).toBe("cancelled");
  });

  test("cancelQuery fails for nonexistent query", () => {
    const { service } = makeIsolatedService();
    const outcome = service.cancelQuery("nonexistent");
    expect(outcome.ok).toBe(false);
  });

  test("cancelQuery fails for already-approved query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ type: "store_status", store_name: "Test" });
    await service.submitQueryResult(
      query.id,
      { type: "store_status", status: "open" },
      { executor_type: "human", channel: "worker_api" },
      "test-oracle",
    );
    const outcome = service.cancelQuery(query.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("already approved");
  });

  test("expireQueries marks expired pending queries", () => {
    const { service } = makeIsolatedService();
    service.createQuery({ type: "store_status", store_name: "Expired" }, { ttlMs: -1 });
    service.createQuery({ type: "store_status", store_name: "Active" }, { ttlMs: 60_000 });
    const count = service.expireQueries();
    expect(count).toBe(1);
  });

  test("purgeExpiredFromStore removes expired queries", () => {
    const { service, store } = makeIsolatedService();
    service.createQuery({ type: "store_status", store_name: "Expired" }, { ttlMs: -1 });
    service.expireQueries();
    const purged = service.purgeExpiredFromStore();
    expect(purged).toHaveLength(1);
    expect(store.values()).toHaveLength(0);
  });

  test("clearQueryStore empties the store", () => {
    const { service, store } = makeIsolatedService();
    service.createQuery({ type: "store_status", store_name: "A" });
    service.createQuery({ type: "store_status", store_name: "B" });
    service.clearQueryStore();
    expect(store.values()).toHaveLength(0);
  });

  test("isolated services do not share state", () => {
    const { service: s1 } = makeIsolatedService();
    const { service: s2 } = makeIsolatedService();
    const q = s1.createQuery({ type: "store_status", store_name: "Test" });
    expect(s1.getQuery(q.id)).not.toBeNull();
    expect(s2.getQuery(q.id)).toBeNull();
  });
});

describe("createIntegrityStore isolation", () => {
  test("instances do not share state", () => {
    const store1 = createIntegrityStore();
    const store2 = createIntegrityStore();
    store1.store({
      attachmentId: "a.jpg",
      queryId: "q1",
      capturedAt: Date.now(),
      exif: { hasExif: false, hasCameraModel: false, hasGps: false, hasTimestamp: false, timestampRecent: false, gpsNearHint: null, metadata: {}, checks: [], failures: [] },
      c2pa: { available: false, hasManifest: false, signatureValid: false, manifest: null, checks: [], failures: [] },
    });
    expect(store1.get("a.jpg")).not.toBeNull();
    expect(store2.get("a.jpg")).toBeNull();
  });
});
