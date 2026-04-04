import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getEncodedToken } from "@cashu/cashu-ts";
import { createPreimageStore } from "../infrastructure/cashu/preimage-store";
import {
  createOracleRegistry,
} from "../infrastructure/oracle/registry";
import type { Oracle, OracleAttestation } from "../domain/oracle-types";
import {
  createQueryService,
  createQueryStore,
} from "./query-service";
import type { Query, QueryResult } from "../domain/types";
import { createIntegrityStore } from "../infrastructure/verification/integrity-store";

/** Create a fake encoded Cashu token with the given total sats. */
function makeFakeToken(amountSats: number): string {
  return getEncodedToken({
    mint: "https://mint.example.com",
    proofs: [{ amount: amountSats, id: "test", secret: "s", C: "C" }],
  });
}

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
  test("stores and retrieves queries", async () => {
    const store = createQueryStore();
    const query = { id: "q1" } as Query;
    store.set("q1", query);
    expect(store.get("q1")).toBe(query);
  });

  test("returns null for unknown id", async () => {
    const store = createQueryStore();
    expect(store.get("unknown")).toBeNull();
  });

  test("lists all values", async () => {
    const store = createQueryStore();
    store.set("a", { id: "a" } as Query);
    store.set("b", { id: "b" } as Query);
    expect(store.values()).toHaveLength(2);
  });

  test("deletes entries", async () => {
    const store = createQueryStore();
    store.set("a", { id: "a" } as Query);
    store.delete("a");
    expect(store.get("a")).toBeNull();
  });

  test("clears all entries", async () => {
    const store = createQueryStore();
    store.set("a", { id: "a" } as Query);
    store.set("b", { id: "b" } as Query);
    store.clear();
    expect(store.values()).toHaveLength(0);
  });

  test("instances are isolated", async () => {
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

  test("createQuery returns a pending query (no nonce by default)", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Test query" });
    expect(query.status).toBe("pending");
    expect(query.challenge_nonce).toBeUndefined();
    expect(query.verification_requirements).toEqual(["gps", "ai_check"]);
    expect(query.id).toMatch(/^query_/);
  });

  test("createQuery generates nonce when nonce factor is requested", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query", verification_requirements: ["nonce", "gps"] },
    );
    expect(query.challenge_nonce).toBeTruthy();
    expect(query.challenge_nonce!.length).toBe(6);
    expect(query.verification_requirements).toEqual(["nonce", "gps"]);
  });

  test("createQuery respects ttlMs option", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { ttlMs: 5000 },
    );
    expect(query.expires_at - query.created_at).toBe(5000);
  });

  test("createQuery respects ttlSeconds option", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { ttlSeconds: 120 },
    );
    expect(query.expires_at - query.created_at).toBe(120_000);
  });

  test("createQuery stores requester_meta", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { requesterMeta: { requester_type: "app", requester_id: "test-app" } },
    );
    expect(query.requester_meta?.requester_type).toBe("app");
    expect(query.requester_meta?.requester_id).toBe("test-app");
  });

  test("createQuery stores oracle_ids", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { oracleIds: ["oracle-a", "oracle-b"] },
    );
    expect(query.oracle_ids).toEqual(["oracle-a", "oracle-b"]);
  });

  test("createQuery stores bounty info", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { bounty: { amount_sats: 100 } },
    );
    expect(query.bounty?.amount_sats).toBe(100);
  });

  test("createQuery fires onCreated hook", async () => {
    const created: Query[] = [];
    const { service } = makeIsolatedService({
      hooks: { onCreated: (q) => created.push(q) },
    });
    service.createQuery({ description: "Test query" });
    expect(created).toHaveLength(1);
  });

  test("getQuery retrieves created query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Test query" });
    expect(service.getQuery(query.id)).toEqual(query);
  });

  test("getQuery returns null for unknown id", async () => {
    const { service } = makeIsolatedService();
    expect(service.getQuery("nonexistent")).toBeNull();
  });

  test("listOpenQueries returns only pending non-expired queries", async () => {
    const { service } = makeIsolatedService();
    service.createQuery({ description: "Active" }, { ttlMs: 60_000 });
    service.createQuery({ description: "Expired" }, { ttlMs: -1 });
    const open = service.listOpenQueries();
    expect(open).toHaveLength(1);
    expect(open[0]!.description).toBe("Active");
  });

  test("submitQueryResult approves valid submission", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Test query" }, { oracleIds: ["test-oracle"] });
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
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
    const query = service.createQuery({ description: "Test query" }, { oracleIds: ["strict-oracle"] });
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
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
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "worker_api" },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.query).toBeNull();
    expect(outcome.message).toBe("Query not found");
  });

  test("submitQueryResult fails for expired query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { ttlMs: -1 },
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "worker_api" },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe("Query has expired");
  });

  test("submitQueryResult fails for already-submitted query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Test query" }, { oracleIds: ["test-oracle"] });
    await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "worker_api" },
      "test-oracle",
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "worker_api" },
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not pending");
  });

  test("submitQueryResult rejects unacceptable oracle", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { oracleIds: ["specific-oracle"] },
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "worker_api" },
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not available or not accepted");
  });

  test("cancelQuery cancels a pending query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Test query" });
    const outcome = service.cancelQuery(query.id);
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("rejected");
    expect(service.getQuery(query.id)?.payment_status).toBe("cancelled");
  });

  test("cancelQuery fails for nonexistent query", async () => {
    const { service } = makeIsolatedService();
    const outcome = service.cancelQuery("nonexistent");
    expect(outcome.ok).toBe(false);
  });

  test("cancelQuery fails for already-approved query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Test query" }, { oracleIds: ["test-oracle"] });
    await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "worker_api" },
      "test-oracle",
    );
    const outcome = service.cancelQuery(query.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("already approved");
  });

  test("expireQueries marks expired pending queries", async () => {
    const { service } = makeIsolatedService();
    service.createQuery({ description: "Expired" }, { ttlMs: -1 });
    service.createQuery({ description: "Active" }, { ttlMs: 60_000 });
    const count = service.expireQueries();
    expect(count).toBe(1);
  });

  test("purgeExpiredFromStore removes expired queries", async () => {
    const { service, store } = makeIsolatedService();
    service.createQuery({ description: "Expired" }, { ttlMs: -1 });
    service.expireQueries();
    const purged = service.purgeExpiredFromStore();
    expect(purged).toHaveLength(1);
    expect(store.values()).toHaveLength(0);
  });

  test("clearQueryStore empties the store", async () => {
    const { service, store } = makeIsolatedService();
    service.createQuery({ description: "A" });
    service.createQuery({ description: "B" });
    service.clearQueryStore();
    expect(store.values()).toHaveLength(0);
  });

  test("isolated services do not share state", async () => {
    const { service: s1 } = makeIsolatedService();
    const { service: s2 } = makeIsolatedService();
    const q = s1.createQuery({ description: "Test" });
    expect(s1.getQuery(q.id)).not.toBeNull();
    expect(s2.getQuery(q.id)).toBeNull();
  });
});

describe("HTLC lifecycle", () => {
  function makeIsolatedService() {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle: Oracle = {
      info: { id: "test-oracle", name: "Mock test-oracle", fee_ppm: 0 },
      async verify(query: Query): Promise<OracleAttestation> {
        return { oracle_id: "test-oracle", query_id: query.id, passed: true, checks: ["ok"], failures: [], attested_at: Date.now() };
      },
    };
    registry.register(oracle);
    return {
      service: createQueryService({ store, oracleRegistry: registry }),
      store,
    };
  }

  const htlcInfo = {
    hash: "abcd1234",
    oracle_pubkey: "oracle_pub",
    requester_pubkey: "requester_pub",
    locktime: Math.floor(Date.now() / 1000) + 3600,
  };

  test("createQuery with htlc option sets awaiting_quotes status", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    expect(query.status).toBe("awaiting_quotes");
    expect(query.payment_status).toBe("htlc_locked");
    expect(query.htlc?.hash).toBe("abcd1234");
    expect(query.quotes).toEqual([]);
  });

  test("recordQuote adds quote to awaiting_quotes query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    const outcome = service.recordQuote(query.id, {
      worker_pubkey: "worker_pub_1",
      amount_sats: 100,
      quote_event_id: "evt_1",
      received_at: Date.now(),
    });
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.quotes).toHaveLength(1);
  });

  test("recordQuote fails on non-HTLC query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Simple query" });
    const outcome = service.recordQuote(query.id, {
      worker_pubkey: "worker_pub_1",
      amount_sats: 100,
      quote_event_id: "evt_1",
      received_at: Date.now(),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Not an HTLC query");
  });

  test("selectWorker transitions awaiting_quotes → processing", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    service.recordQuote(query.id, { worker_pubkey: "worker_pub_1", quote_event_id: "evt_1", received_at: Date.now() });
    const outcome = await service.selectWorker(query.id, "worker_pub_1", "htlc_token_123");
    expect(outcome.ok).toBe(true);
    const updated = service.getQuery(query.id)!;
    expect(updated.status).toBe("processing");
    expect(updated.htlc?.worker_pubkey).toBe("worker_pub_1");
    expect(updated.payment_status).toBe("htlc_swapped");
  });

  test("selectWorker verifies escrow token amount matches bounty", async () => {
    const { service } = makeIsolatedService();
    const validToken = makeFakeToken(100);
    const query = service.createQuery(
      { description: "HTLC test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 } },
    );
    const outcome = await service.selectWorker(query.id, "worker_pub_1", validToken);
    expect(outcome.ok).toBe(true);
    const updated = service.getQuery(query.id)!;
    expect(updated.htlc?.verified_escrow_sats).toBe(100);
  });

  test("selectWorker rejects escrow token with insufficient amount", async () => {
    const { service } = makeIsolatedService();
    const smallToken = makeFakeToken(50);
    const query = service.createQuery(
      { description: "HTLC test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 } },
    );
    const outcome = await service.selectWorker(query.id, "worker_pub_1", smallToken);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Insufficient amount");
    expect(outcome.message).toContain("50");
    // Query should remain in awaiting_quotes
    expect(service.getQuery(query.id)?.status).toBe("awaiting_quotes");
  });

  test("selectWorker rejects invalid escrow token", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "HTLC test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 } },
    );
    const outcome = await service.selectWorker(query.id, "worker_pub_1", "not_a_valid_token");
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Escrow token verification failed");
    expect(service.getQuery(query.id)?.status).toBe("awaiting_quotes");
  });

  test("selectWorker accepts token with more than bounty amount", async () => {
    const { service } = makeIsolatedService();
    const bigToken = makeFakeToken(200);
    const query = service.createQuery(
      { description: "HTLC test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 } },
    );
    const outcome = await service.selectWorker(query.id, "worker_pub_1", bigToken);
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.htlc?.verified_escrow_sats).toBe(200);
  });

  test("selectWorker fails on wrong state", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    await service.selectWorker(query.id, "worker_pub_1");
    const outcome = await service.selectWorker(query.id, "worker_pub_2");
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not awaiting_quotes");
  });

  test("recordResult transitions processing → verifying", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    await service.selectWorker(query.id, "worker_pub_1");
    const outcome = service.recordResult(query.id, { attachments: [], notes: "done" }, "worker_pub_1");
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("verifying");
  });

  test("recordResult fails for wrong worker", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    await service.selectWorker(query.id, "worker_pub_1");
    const outcome = service.recordResult(query.id, { attachments: [] }, "wrong_worker");
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("does not match");
  });

  test("completeVerification transitions verifying → approved", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    await service.selectWorker(query.id, "worker_pub_1");
    service.recordResult(query.id, { attachments: [] }, "worker_pub_1");
    const outcome = service.completeVerification(query.id, true, "test-oracle");
    expect(outcome.ok).toBe(true);
    const updated = service.getQuery(query.id)!;
    expect(updated.status).toBe("approved");
    expect(updated.payment_status).toBe("released");
    expect(updated.assigned_oracle_id).toBe("test-oracle");
  });

  test("completeVerification transitions verifying → rejected", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    await service.selectWorker(query.id, "worker_pub_1");
    service.recordResult(query.id, { attachments: [] }, "worker_pub_1");
    const outcome = service.completeVerification(query.id, false);
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("rejected");
    expect(service.getQuery(query.id)?.payment_status).toBe("cancelled");
  });

  test("listOpenQueries includes HTLC queries in active states", async () => {
    const { service } = makeIsolatedService();
    service.createQuery({ description: "Simple" }, { ttlMs: 60_000 });
    service.createQuery({ description: "HTLC" }, { htlc: htlcInfo, ttlMs: 60_000 });
    const open = service.listOpenQueries();
    expect(open).toHaveLength(2);
  });

  test("full HTLC lifecycle: create → quote → select → result → verify", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Full HTLC" }, { htlc: htlcInfo });
    expect(query.status).toBe("awaiting_quotes");

    service.recordQuote(query.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
    service.recordQuote(query.id, { worker_pubkey: "w2", amount_sats: 50, quote_event_id: "e2", received_at: Date.now() });
    expect(service.getQuery(query.id)?.quotes).toHaveLength(2);

    await service.selectWorker(query.id, "w1", "final_htlc_token");
    expect(service.getQuery(query.id)?.status).toBe("processing");

    service.recordResult(query.id, { attachments: [], notes: "photo taken" }, "w1");
    expect(service.getQuery(query.id)?.status).toBe("verifying");

    service.completeVerification(query.id, true, "test-oracle");
    expect(service.getQuery(query.id)?.status).toBe("approved");
    expect(service.getQuery(query.id)?.payment_status).toBe("released");
  });
});

describe("submitHtlcResult", () => {
  function makeIsolatedServiceWithPreimage(opts?: {
    mockOracle?: Oracle;
  }) {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle = opts?.mockOracle ?? makeMockOracle("test-oracle");
    registry.register(oracle);
    const preimageStore = createPreimageStore();
    return {
      service: createQueryService({
        store,
        oracleRegistry: registry,
        preimageStore,
      }),
      store,
      registry,
      preimageStore,
    };
  }

  /** Create htlcInfo using a real preimage hash from the store. */
  function makeHtlcWithHash(preimageStore: ReturnType<typeof import("../infrastructure/cashu/preimage-store").createPreimageStore>) {
    const entry = preimageStore.create();
    return {
      htlcInfo: {
        hash: entry.hash,
        oracle_pubkey: "oracle_pub",
        requester_pubkey: "requester_pub",
        locktime: Math.floor(Date.now() / 1000) + 3600,
      },
      entry,
    };
  }

  test("submitHtlcResult returns preimage on verification success", async () => {
    const { service, preimageStore } = makeIsolatedServiceWithPreimage();
    const { htlcInfo, entry } = makeHtlcWithHash(preimageStore);
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo, oracleIds: ["test-oracle"] });
    await service.selectWorker(query.id, "w1");
    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [], notes: "done" },
      "w1",
      "test-oracle",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBe(entry.preimage);
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.payment_status).toBe("released");
  });

  test("submitHtlcResult does not return preimage on verification failure", async () => {
    const { service, preimageStore } = makeIsolatedServiceWithPreimage({
      mockOracle: makeMockOracle("strict-oracle", () => false),
    });
    const { htlcInfo } = makeHtlcWithHash(preimageStore);
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo, oracleIds: ["strict-oracle"] });
    await service.selectWorker(query.id, "w1");
    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      "w1",
      "strict-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
    expect(outcome.query?.status).toBe("rejected");
    expect(outcome.query?.payment_status).toBe("cancelled");
  });

  test("submitHtlcResult fails for non-HTLC query", async () => {
    const { service } = makeIsolatedServiceWithPreimage();
    const query = service.createQuery({ description: "Simple query" });
    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Not an HTLC query");
  });

  test("submitHtlcResult fails for wrong worker", async () => {
    const { service, preimageStore } = makeIsolatedServiceWithPreimage();
    const { htlcInfo } = makeHtlcWithHash(preimageStore);
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    await service.selectWorker(query.id, "w1");
    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      "wrong_worker",
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("does not match");
  });

  test("submitHtlcResult fails for wrong state", async () => {
    const { service, preimageStore } = makeIsolatedServiceWithPreimage();
    const { htlcInfo } = makeHtlcWithHash(preimageStore);
    const query = service.createQuery({ description: "HTLC test" }, { htlc: htlcInfo });
    // Still in awaiting_quotes, not processing
    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not processing");
  });
});

describe("verifyWithQuorum", () => {
  function makeQuorumService(oracleSpecs: Array<{ id: string; pass: boolean }>) {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    for (const spec of oracleSpecs) {
      registry.register(makeMockOracle(spec.id, () => spec.pass));
    }
    return {
      service: createQueryService({ store, oracleRegistry: registry }),
      store,
      registry,
    };
  }

  test("2-of-3 quorum passes when 2 oracles approve", async () => {
    const { service } = makeQuorumService([
      { id: "oracle-a", pass: true },
      { id: "oracle-b", pass: true },
      { id: "oracle-c", pass: false },
    ]);
    const query = service.createQuery(
      { description: "Quorum test" },
      {
        oracleIds: ["oracle-a", "oracle-b", "oracle-c"],
        quorum: { min_approvals: 2 },
      },
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "test" },
      { executor_type: "human", channel: "worker_api" },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.attestations).toHaveLength(3);
    expect(outcome.query?.attestations?.filter((a) => a.passed)).toHaveLength(2);
  });

  test("2-of-3 quorum fails when only 1 oracle approves", async () => {
    const { service } = makeQuorumService([
      { id: "oracle-a", pass: true },
      { id: "oracle-b", pass: false },
      { id: "oracle-c", pass: false },
    ]);
    const query = service.createQuery(
      { description: "Quorum test" },
      {
        oracleIds: ["oracle-a", "oracle-b", "oracle-c"],
        quorum: { min_approvals: 2 },
      },
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "test" },
      { executor_type: "human", channel: "worker_api" },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.query?.status).toBe("rejected");
    expect(outcome.query?.attestations).toHaveLength(3);
  });

  test("no quorum config uses single oracle (backward compat)", async () => {
    const { service } = makeQuorumService([
      { id: "oracle-a", pass: true },
      { id: "oracle-b", pass: false },
    ]);
    const query = service.createQuery(
      { description: "No quorum" },
      { oracleIds: ["oracle-a"] },
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "test" },
      { executor_type: "human", channel: "worker_api" },
      "oracle-a",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.attestations).toBeUndefined();
  });

  test("quorum with HTLC submitHtlcResult", async () => {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    registry.register(makeMockOracle("oracle-a", () => true));
    registry.register(makeMockOracle("oracle-b", () => true));
    const preimageStore = createPreimageStore();
    const service = createQueryService({ store, oracleRegistry: registry, preimageStore });

    const entry = preimageStore.create();
    const htlcInfo = {
      hash: entry.hash,
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "req_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };
    const query = service.createQuery(
      { description: "Quorum HTLC" },
      {
        htlc: htlcInfo,
        oracleIds: ["oracle-a", "oracle-b"],
        quorum: { min_approvals: 2 },
      },
    );
    await service.selectWorker(query.id, "w1");

    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      "w1",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBe(entry.preimage);
    expect(outcome.query?.attestations).toHaveLength(2);
  });
});

describe("createIntegrityStore isolation", () => {
  test("instances do not share state", async () => {
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
