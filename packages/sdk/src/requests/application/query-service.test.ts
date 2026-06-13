import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getDecodedToken, getEncodedToken } from "@cashu/cashu-ts";
import { createPreimageStore, type PreimageStore } from "../../payments/mod.ts";
import { createOracleRegistry } from "../../testing/oracle-registry.ts";
import type { Oracle, OracleAttestation } from "../domain/oracle-types.ts";
import { createQueryService, createQueryStore } from "./query-service.ts";
import type { Query, QueryResult } from "../domain/types.ts";
import type { EscrowProvider } from "./ports.ts";
import { createIntegrityStore } from "../../proofs/mod.ts";

function makeFakeToken(amountSats: number): string {
  return getEncodedToken({
    mint: "https://mint.example.com",
    proofs: [{ amount: amountSats, id: "test", secret: "s", C: "C" }],
  });
}

function makeMockOracle(
  id: string,
  passFn?: (query: Query, result: QueryResult) => boolean,
): Oracle {
  return {
    info: { id, name: `Mock ${id}`, fee_ppm: 0 },
    async verify(
      query: Query,
      result: QueryResult,
    ): Promise<OracleAttestation> {
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
    expect(query.verification_requirements).toEqual([]);
    expect(query.id).toMatch(/^query_/);
  });

  test("createQuery generates nonce when nonce factor is requested", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      {
        description: "Test query",
        verification_requirements: ["nonce", "c2pa"],
      },
    );
    expect(query.challenge_nonce).toBeTruthy();
    expect(query.challenge_nonce!.length).toBe(6);
    expect(query.verification_requirements).toEqual(["nonce", "c2pa"]);
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

  test("createQuery stores customer_meta", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { customerMeta: { customer_type: "app", customer_id: "test-app" } },
    );
    expect(query.customer_meta?.customer_type).toBe("app");
    expect(query.customer_meta?.customer_id).toBe("test-app");
  });

  test("createQuery stores oracle_ids", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { oracleIds: ["oracle-a", "oracle-b"] },
    );
    expect(query.oracle_ids).toEqual(["oracle-a", "oracle-b"]);
  });

  test("createQuery stores payment_lock info", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "Test query" },
      { payment_lock: { amount_sats: 100 } },
    );
    expect(query.payment_lock?.amount_sats).toBe(100);
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
    const query = service.createQuery({ description: "Test query" }, {
      oracleIds: ["test-oracle"],
    });
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "adapter" },
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
    const query = service.createQuery({ description: "Test query" }, {
      oracleIds: ["strict-oracle"],
    });
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "adapter" },
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
      { executor_type: "human", channel: "adapter" },
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
      { executor_type: "human", channel: "adapter" },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe("Query has expired");
  });

  test("submitQueryResult fails for already-submitted query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Test query" }, {
      oracleIds: ["test-oracle"],
    });
    await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "adapter" },
      "test-oracle",
    );
    const outcome = await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "adapter" },
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
      { executor_type: "human", channel: "adapter" },
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
    const query = service.createQuery({ description: "Test query" }, {
      oracleIds: ["test-oracle"],
    });
    await service.submitQueryResult(
      query.id,
      { attachments: [], notes: "open" },
      { executor_type: "human", channel: "adapter" },
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
  function createMockEscrowProvider(): EscrowProvider {
    return {
      async createHold() {
        return { escrow_ref: "mock_ref" };
      },
      async bindProvider(_ref, _wp) {
        return { escrow_ref: "mock_ref_bound" };
      },
      async verify(_ref, expected_sats) {
        try {
          const decoded = getDecodedToken(_ref);
          const total = decoded.proofs.reduce((sum, p) => sum + p.amount, 0);
          if (total < expected_sats) {
            return {
              valid: false,
              amount_sats: total,
              error:
                `Insufficient amount: got ${total}, expected ${expected_sats}`,
            };
          }
          return { valid: true, amount_sats: total };
        } catch {
          return { valid: false, error: "Invalid token" };
        }
      },
      async verifyLock() {
        return { ok: true };
      },
      async settle() {
        return { settled: true };
      },
      async cancel() {
        return { cancelled: true };
      },
    };
  }

  function makeIsolatedService() {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle: Oracle = {
      info: { id: "test-oracle", name: "Mock test-oracle", fee_ppm: 0 },
      async verify(query: Query): Promise<OracleAttestation> {
        return {
          oracle_id: "test-oracle",
          query_id: query.id,
          passed: true,
          checks: ["ok"],
          failures: [],
          attested_at: Date.now(),
        };
      },
    };
    registry.register(oracle);
    return {
      service: createQueryService({
        store,
        oracleRegistry: registry,
        escrowProvider: createMockEscrowProvider(),
      }),
      store,
    };
  }

  const escrowInfo = {
    type: "htlc" as const,
    hash: "abcd1234",
    oracle_pubkeys: ["oracle_pub"],
    customer_pubkey: "customer_pub",
    locktime: Math.floor(Date.now() / 1000) + 3600,
  };

  test("createQuery with htlc option sets awaiting_offers status", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    expect(query.status).toBe("awaiting_offers");
    expect(query.payment_status).toBe("escrow_locked");
    expect(query.escrow?.type).toBe("htlc");
    if (query.escrow?.type === "htlc") {
      expect(query.escrow.hash).toBe("abcd1234");
    }
    expect(query.offers).toEqual([]);
  });

  test("recordOffer adds offer to awaiting_offers query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    const outcome = service.recordOffer(query.id, {
      provider_pubkey: "provider_pub_1",
      amount_sats: 100,
      offer_event_id: "evt_1",
      received_at: Date.now(),
    });
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.offers).toHaveLength(1);
  });

  test("recordOffer fails on non-HTLC query", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Simple query" });
    const outcome = service.recordOffer(query.id, {
      provider_pubkey: "provider_pub_1",
      amount_sats: 100,
      offer_event_id: "evt_1",
      received_at: Date.now(),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Not an escrow query");
  });

  test("selectProvider transitions awaiting_offers → provider_selected", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    service.recordOffer(query.id, {
      provider_pubkey: "provider_pub_1",
      offer_event_id: "evt_1",
      received_at: Date.now(),
    });
    const outcome = await service.selectProvider(
      query.id,
      "provider_pub_1",
      "htlc_token_123",
    );
    expect(outcome.ok).toBe(true);
    const updated = service.getQuery(query.id)!;
    expect(updated.status).toBe("provider_selected");
    expect(updated.escrow?.provider_pubkey).toBe("provider_pub_1");
    expect(updated.payment_status).toBe("escrow_swapped");
  });

  test("CTF-2: selectProvider fails closed when no escrow provider port is wired", async () => {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const service = createQueryService({
      store,
      oracleRegistry: registry,
      // No escrowProvider: the token can never be amount/lock verified.
    });
    const query = service.createQuery(
      { description: "HTLC test" },
      { escrow: escrowInfo, payment_lock: { amount_sats: 100 } },
    );
    const outcome = await service.selectProvider(
      query.id,
      "provider_pub_1",
      makeFakeToken(100),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Escrow provider port not configured");
    expect(service.getQuery(query.id)?.status).toBe("awaiting_offers");
  });

  test("selectProvider verifies escrow token amount matches payment_lock", async () => {
    const { service } = makeIsolatedService();
    const validToken = makeFakeToken(100);
    const query = service.createQuery(
      { description: "HTLC test" },
      { escrow: escrowInfo, payment_lock: { amount_sats: 100 } },
    );
    const outcome = await service.selectProvider(
      query.id,
      "provider_pub_1",
      validToken,
    );
    expect(outcome.ok).toBe(true);
    const updated = service.getQuery(query.id)!;
    expect(updated.escrow?.verified_escrow_sats).toBe(100);
  });

  test("selectProvider rejects escrow token with insufficient amount", async () => {
    const { service } = makeIsolatedService();
    const smallToken = makeFakeToken(50);
    const query = service.createQuery(
      { description: "HTLC test" },
      { escrow: escrowInfo, payment_lock: { amount_sats: 100 } },
    );
    const outcome = await service.selectProvider(
      query.id,
      "provider_pub_1",
      smallToken,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Insufficient amount");
    expect(outcome.message).toContain("50");
    expect(service.getQuery(query.id)?.status).toBe("awaiting_offers");
  });

  test("selectProvider rejects invalid escrow token", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery(
      { description: "HTLC test" },
      { escrow: escrowInfo, payment_lock: { amount_sats: 100 } },
    );
    const outcome = await service.selectProvider(
      query.id,
      "provider_pub_1",
      "not_a_valid_token",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Escrow token verification failed");
    expect(service.getQuery(query.id)?.status).toBe("awaiting_offers");
  });

  test("selectProvider accepts token with more than payment_lock amount", async () => {
    const { service } = makeIsolatedService();
    const bigToken = makeFakeToken(200);
    const query = service.createQuery(
      { description: "HTLC test" },
      { escrow: escrowInfo, payment_lock: { amount_sats: 100 } },
    );
    const outcome = await service.selectProvider(
      query.id,
      "provider_pub_1",
      bigToken,
    );
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.escrow?.verified_escrow_sats).toBe(200);
  });

  test("selectProvider fails on wrong state", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    await service.selectProvider(query.id, "provider_pub_1");
    const outcome = await service.selectProvider(query.id, "provider_pub_2");
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not awaiting_offers");
  });

  test("recordResult transitions processing → verifying", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    await service.selectProvider(query.id, "provider_pub_1");
    service.beginWork(query.id);
    const outcome = service.recordResult(query.id, {
      attachments: [],
      notes: "done",
    }, "provider_pub_1");
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("verifying");
  });

  test("recordResult fails for wrong provider", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    await service.selectProvider(query.id, "provider_pub_1");
    service.beginWork(query.id);
    const outcome = service.recordResult(
      query.id,
      { attachments: [] },
      "wrong_provider",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("does not match");
  });

  test("completeVerification transitions verifying → approved", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    await service.selectProvider(query.id, "provider_pub_1");
    service.beginWork(query.id);
    service.recordResult(query.id, { attachments: [] }, "provider_pub_1");
    const outcome = service.completeVerification(query.id, true, "test-oracle");
    expect(outcome.ok).toBe(true);
    const updated = service.getQuery(query.id)!;
    expect(updated.status).toBe("approved");
    expect(updated.payment_status).toBe("released");
    expect(updated.assigned_oracle_id).toBe("test-oracle");
  });

  test("completeVerification transitions verifying → rejected", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    await service.selectProvider(query.id, "provider_pub_1");
    service.beginWork(query.id);
    service.recordResult(query.id, { attachments: [] }, "provider_pub_1");
    const outcome = service.completeVerification(query.id, false);
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("rejected");
    expect(service.getQuery(query.id)?.payment_status).toBe("cancelled");
  });

  test("listOpenQueries includes HTLC queries in active states", async () => {
    const { service } = makeIsolatedService();
    service.createQuery({ description: "Simple" }, { ttlMs: 60_000 });
    service.createQuery({ description: "HTLC" }, {
      escrow: escrowInfo,
      ttlMs: 60_000,
    });
    const open = service.listOpenQueries();
    expect(open).toHaveLength(2);
  });

  test("full HTLC lifecycle: create → offer → select → result → verify", async () => {
    const { service } = makeIsolatedService();
    const query = service.createQuery({ description: "Full HTLC" }, {
      escrow: escrowInfo,
    });
    expect(query.status).toBe("awaiting_offers");

    service.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    service.recordOffer(query.id, {
      provider_pubkey: "w2",
      amount_sats: 50,
      offer_event_id: "e2",
      received_at: Date.now(),
    });
    expect(service.getQuery(query.id)?.offers).toHaveLength(2);

    await service.selectProvider(query.id, "w1", "final_htlc_token");
    expect(service.getQuery(query.id)?.status).toBe("provider_selected");

    service.beginWork(query.id);
    service.recordResult(
      query.id,
      { attachments: [], notes: "photo taken" },
      "w1",
    );
    expect(service.getQuery(query.id)?.status).toBe("verifying");

    service.completeVerification(query.id, true, "test-oracle");
    expect(service.getQuery(query.id)?.status).toBe("approved");
    expect(service.getQuery(query.id)?.payment_status).toBe("released");
  });
});

describe("submitEscrowResult", () => {
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

  /** Create escrowInfo using a real preimage hash from the store. */
  function makeHtlcWithHash(preimageStore: PreimageStore) {
    const entry = preimageStore.create();
    return {
      escrowInfo: {
        type: "htlc" as const,
        hash: entry.hash,
        oracle_pubkeys: ["oracle_pub"],
        customer_pubkey: "customer_pub",
        locktime: Math.floor(Date.now() / 1000) + 3600,
      },
      entry,
    };
  }

  test("submitEscrowResult returns preimage on verification success", async () => {
    const { service, preimageStore } = makeIsolatedServiceWithPreimage();
    const { escrowInfo, entry } = makeHtlcWithHash(preimageStore);
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
      oracleIds: ["test-oracle"],
    });
    await service.selectProvider(query.id, "w1");
    service.beginWork(query.id);
    const outcome = await service.submitEscrowResult(
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

  test("submitEscrowResult does not return preimage on verification failure", async () => {
    const { service, preimageStore } = makeIsolatedServiceWithPreimage({
      mockOracle: makeMockOracle("strict-oracle", () => false),
    });
    const { escrowInfo } = makeHtlcWithHash(preimageStore);
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
      oracleIds: ["strict-oracle"],
    });
    await service.selectProvider(query.id, "w1");
    service.beginWork(query.id);
    const outcome = await service.submitEscrowResult(
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

  test("submitEscrowResult fails for non-HTLC query", async () => {
    const { service } = makeIsolatedServiceWithPreimage();
    const query = service.createQuery({ description: "Simple query" });
    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Not an escrow query");
  });

  test("submitEscrowResult fails for wrong provider", async () => {
    const { service, preimageStore } = makeIsolatedServiceWithPreimage();
    const { escrowInfo } = makeHtlcWithHash(preimageStore);
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    await service.selectProvider(query.id, "w1");
    service.beginWork(query.id);
    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      "wrong_provider",
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("does not match");
  });

  test("submitEscrowResult fails for wrong state", async () => {
    const { service, preimageStore } = makeIsolatedServiceWithPreimage();
    const { escrowInfo } = makeHtlcWithHash(preimageStore);
    const query = service.createQuery({ description: "HTLC test" }, {
      escrow: escrowInfo,
    });
    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not processing");
  });

  test("submitEscrowResult delivers a FROST signature for p2pk_frost queries on success", async () => {
    const requested: Array<{ queryId: string; notes?: string }> = [];
    const mockFrost = {
      requestSignature: async (query: Query, result: QueryResult) => {
        requested.push({ queryId: query.id, notes: result.notes });
        return ["deadbeef".repeat(8)];
      },
    };
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    registry.register(makeMockOracle("test-oracle"));
    const service = createQueryService({
      store,
      oracleRegistry: registry,
      frostSignature: mockFrost,
    });
    const query = service.createQuery({ description: "FROST settlement" }, {
      escrow: {
        type: "p2pk_frost" as const,
        group_pubkey: "f".repeat(64),
        oracle_pubkeys: ["s1", "s2", "s3"],
        customer_pubkey: "rpub",
        locktime: Math.floor(Date.now() / 1000) + 3600,
      },
      oracleIds: ["test-oracle"],
    });
    await service.selectProvider(query.id, "w1");
    service.beginWork(query.id);
    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [], notes: "frost done" },
      "w1",
      "test-oracle",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.frost_signature).toEqual(["deadbeef".repeat(8)]);
    expect(outcome.preimage).toBeUndefined();
    expect(requested).toHaveLength(1);
    expect(requested[0]!.queryId).toBe(query.id);
    expect(requested[0]!.notes).toBe("frost done");
  });

  test("submitEscrowResult does NOT request a FROST signature on rejected verification", async () => {
    let calls = 0;
    const mockFrost = {
      requestSignature: async (_q: Query, _r: QueryResult) => {
        calls++;
        return ["should_not_appear"];
      },
    };
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    registry.register(makeMockOracle("strict-oracle", () => false));
    const service = createQueryService({
      store,
      oracleRegistry: registry,
      frostSignature: mockFrost,
    });
    const query = service.createQuery({ description: "FROST reject" }, {
      escrow: {
        type: "p2pk_frost" as const,
        group_pubkey: "f".repeat(64),
        oracle_pubkeys: ["s1"],
        customer_pubkey: "rpub",
        locktime: Math.floor(Date.now() / 1000) + 3600,
      },
      oracleIds: ["strict-oracle"],
    });
    await service.selectProvider(query.id, "w1");
    service.beginWork(query.id);
    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      "w1",
      "strict-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.frost_signature).toBeUndefined();
    expect(outcome.preimage).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("submitEscrowResult swallows FROST coordinator errors and falls through", async () => {
    const mockFrost = {
      requestSignature: async () => {
        throw new Error("coordinator unreachable");
      },
    };
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    registry.register(makeMockOracle("test-oracle"));
    const service = createQueryService({
      store,
      oracleRegistry: registry,
      frostSignature: mockFrost,
    });
    const query = service.createQuery({ description: "FROST throws" }, {
      escrow: {
        type: "p2pk_frost" as const,
        group_pubkey: "f".repeat(64),
        oracle_pubkeys: ["s1"],
        customer_pubkey: "rpub",
        locktime: Math.floor(Date.now() / 1000) + 3600,
      },
      oracleIds: ["test-oracle"],
    });
    await service.selectProvider(query.id, "w1");
    service.beginWork(query.id);
    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.frost_signature).toBeUndefined();
    expect(outcome.preimage).toBeUndefined();
    expect(outcome.message).toContain("Verification passed");
  });
});

describe("verifyWithQuorum", () => {
  function makeQuorumService(
    oracleSpecs: Array<{ id: string; pass: boolean }>,
  ) {
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
      { executor_type: "human", channel: "adapter" },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.attestations).toHaveLength(3);
    expect(outcome.query?.attestations?.filter((a) => a.passed)).toHaveLength(
      2,
    );
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
      { executor_type: "human", channel: "adapter" },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.query?.status).toBe("rejected");
    expect(outcome.query?.attestations).toHaveLength(3);
  });

  test("no quorum config uses single oracle path", async () => {
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
      { executor_type: "human", channel: "adapter" },
      "oracle-a",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.attestations).toBeUndefined();
  });

  test("quorum with HTLC submitEscrowResult", async () => {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    registry.register(makeMockOracle("oracle-a", () => true));
    registry.register(makeMockOracle("oracle-b", () => true));
    const preimageStore = createPreimageStore();
    const service = createQueryService({
      store,
      oracleRegistry: registry,
      preimageStore,
    });

    const entry = preimageStore.create();
    const escrowInfo = {
      type: "htlc" as const,
      hash: entry.hash,
      oracle_pubkeys: ["oracle_pub"],
      customer_pubkey: "req_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };
    const query = service.createQuery(
      { description: "Quorum HTLC" },
      {
        escrow: escrowInfo,
        oracleIds: ["oracle-a", "oracle-b"],
        quorum: { min_approvals: 2 },
      },
    );
    await service.selectProvider(query.id, "w1");
    service.beginWork(query.id);

    const outcome = await service.submitEscrowResult(
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
      requestId: "q1",
      capturedAt: Date.now(),
      exif: {
        hasExif: false,
        hasCameraModel: false,
        hasGps: false,
        hasTimestamp: false,
        timestampRecent: false,
        gpsNearHint: null,
        metadata: {},
        checks: [],
        failures: [],
      },
      c2pa: {
        available: false,
        hasManifest: false,
        signatureValid: false,
        manifest: null,
        checks: [],
        failures: [],
      },
    });
    expect(store1.get("a.jpg")).not.toBeNull();
    expect(store2.get("a.jpg")).toBeNull();
  });
});
