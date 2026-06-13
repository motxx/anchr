import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createOracleRegistry } from "@anchr/sdk/adapters/oracle-client";
import { createPreimageStore } from "@anchr/sdk/payments";
import { createQueryService, createQueryStore } from "@anchr/sdk/testing";
import {
  driveToProcessing,
  makeEscrowInfo,
  makeFakeToken,
  makeMockOracle,
  makeServiceWithPreimage,
} from "@anchr/sdk/testing";

describe("Attack: Preimage Isolation", () => {
  test("preimage reuse across queries — second query cannot re-use revealed preimage", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();

    const entry1 = await preimageStore.create();
    const escrowInfo1 = {
      type: "htlc" as const,
      hash: entry1.hash,
      oracle_pubkeys: ["oracle_pub"],
      customer_pubkey: "customer_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const q1 = service.createQuery(
      { description: "Query 1" },
      {
        escrow: escrowInfo1,
        payment_lock: { amount_sats: 100 },
        oracleIds: ["test-oracle"],
      },
    );
    service.recordOffer(q1.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectProvider(q1.id, "w1", makeFakeToken(100));
    service.beginWork(q1.id);

    const outcome1 = await service.submitEscrowResult(
      q1.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );
    expect(outcome1.ok).toBe(true);
    expect(outcome1.preimage).toBe(entry1.preimage);

    expect(await preimageStore.getPreimage(entry1.hash)).toBeNull();

    const escrowInfo2 = {
      type: "htlc" as const,
      hash: entry1.hash, // REUSED hash
      oracle_pubkeys: ["oracle_pub"],
      customer_pubkey: "customer_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const q2 = service.createQuery(
      { description: "Query 2 reuse" },
      {
        escrow: escrowInfo2,
        payment_lock: { amount_sats: 100 },
        oracleIds: ["test-oracle"],
      },
    );
    service.recordOffer(q2.id, {
      provider_pubkey: "w2",
      offer_event_id: "e2",
      received_at: Date.now(),
    });
    await service.selectProvider(q2.id, "w2", makeFakeToken(100));
    service.beginWork(q2.id);

    const outcome2 = await service.submitEscrowResult(
      q2.id,
      { attachments: [] },
      "w2",
      "test-oracle",
    );
    expect(outcome2.ok).toBe(true);
    // Preimage was deleted on the first query's reveal — cannot be re-revealed even with same hash
    expect(outcome2.preimage).toBeUndefined();
  });

  test("preimage not leaked on rejected verification", async () => {
    // INV-02
    const { service, preimageStore } = makeServiceWithPreimage({
      mockOracle: makeMockOracle("strict-oracle", () => false),
    });
    const { query, entry, providerPub } = await driveToProcessing(
      service,
      preimageStore,
      { oracleIds: ["strict-oracle"] },
    );

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [], notes: "garbage" },
      providerPub,
      "strict-oracle",
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
    // Preimage remains in store (not deleted) — but NOT leaked to caller
    expect(await preimageStore.getPreimage(entry.hash)).toBe(entry.preimage);
  });

  test("deleted preimage cannot be re-requested via second submitEscrowResult", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query, entry, providerPub } = await driveToProcessing(
      service,
      preimageStore,
    );

    const first = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      providerPub,
      "test-oracle",
    );
    expect(first.ok).toBe(true);
    expect(first.preimage).toBe(entry.preimage);
    expect(await preimageStore.getPreimage(entry.hash)).toBeNull();

    const second = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      providerPub,
      "test-oracle",
    );
    expect(second.ok).toBe(false);
    expect(second.preimage).toBeUndefined();
  });
});

describe("Attack: Race Conditions & Timing", () => {
  test("cancel during processing — query moves to rejected", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();

    const { escrowInfo } = await makeEscrowInfo(preimageStore);
    const query = service.createQuery(
      { description: "Cancel attack" },
      { escrow: escrowInfo, payment_lock: { amount_sats: 100 } },
    );
    service.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectProvider(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    const cancel = service.cancelQuery(query.id);
    expect(cancel.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("rejected");
  });

  test("expiry during processing expires correctly", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const entry = await preimageStore.create();

    const escrowInfo = {
      type: "htlc" as const,
      hash: entry.hash,
      oracle_pubkeys: ["oracle_pub"],
      customer_pubkey: "customer_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const query = service.createQuery(
      { description: "Expiry attack" },
      { escrow: escrowInfo, payment_lock: { amount_sats: 100 }, ttlMs: 1 },
    );
    service.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectProvider(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    // Wait past the 1ms ttl so the expiry sweep observes it as expired
    await new Promise((r) => setTimeout(r, 5));

    const expired = service.expireQueries();
    expect(expired).toBeGreaterThanOrEqual(1);

    expect(service.getQuery(query.id)?.status).toBe("expired");
  });

  test("submit result to expired query fails", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const entry = await preimageStore.create();

    const escrowInfo = {
      type: "htlc" as const,
      hash: entry.hash,
      oracle_pubkeys: ["oracle_pub"],
      customer_pubkey: "customer_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const query = service.createQuery(
      { description: "Expired submit" },
      { escrow: escrowInfo, payment_lock: { amount_sats: 100 }, ttlMs: 1 },
    );
    service.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectProvider(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    await new Promise((r) => setTimeout(r, 5));
    service.expireQueries();

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
  });

  test("double-submit by provider — second attempt fails, first preimage valid", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query, entry, providerPub } = await driveToProcessing(
      service,
      preimageStore,
    );

    const first = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      providerPub,
      "test-oracle",
    );
    expect(first.ok).toBe(true);
    expect(first.preimage).toBe(entry.preimage);

    const second = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      providerPub,
      "test-oracle",
    );
    expect(second.ok).toBe(false);
    expect(second.message).toContain("not processing");
    expect(second.preimage).toBeUndefined();
  });
});

describe("Attack: Oracle Manipulation", () => {
  test("dishonest oracle approves garbage — preimage still revealed (oracle judgment is final)", async () => {
    const { service, preimageStore } = makeServiceWithPreimage({
      mockOracle: makeMockOracle("rubber-stamp", () => true),
    });
    const { query, entry, providerPub } = await driveToProcessing(
      service,
      preimageStore,
      { oracleIds: ["rubber-stamp"] },
    );

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [], notes: "" },
      providerPub,
      "rubber-stamp",
    );

    // Protocol correctness invariant: oracle judgment is final, even for empty/garbage input
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBe(entry.preimage);
  });

  test("oracle flip-flop — first rejects, new query with fresh preimage works", async () => {
    const { service, preimageStore } = makeServiceWithPreimage({
      mockOracle: makeMockOracle("flip-oracle", () => false),
    });

    const { escrowInfo: escrowInfo1 } = await makeEscrowInfo(preimageStore);
    const q1 = service.createQuery(
      { description: "Flip-flop Q1" },
      {
        escrow: escrowInfo1,
        payment_lock: { amount_sats: 100 },
        oracleIds: ["flip-oracle"],
      },
    );
    service.recordOffer(q1.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectProvider(q1.id, "w1", makeFakeToken(100));
    service.beginWork(q1.id);

    const outcome1 = await service.submitEscrowResult(
      q1.id,
      { attachments: [] },
      "w1",
      "flip-oracle",
    );
    expect(outcome1.ok).toBe(false);
    expect(outcome1.preimage).toBeUndefined();

    const { service: service2, preimageStore: ps2 } = makeServiceWithPreimage();

    const { escrowInfo: escrowInfo2, entry: entry2 } = await makeEscrowInfo(
      ps2,
    );
    const q2 = service2.createQuery(
      { description: "Flip-flop Q2" },
      {
        escrow: escrowInfo2,
        payment_lock: { amount_sats: 100 },
        oracleIds: ["test-oracle"],
      },
    );
    service2.recordOffer(q2.id, {
      provider_pubkey: "w2",
      offer_event_id: "e2",
      received_at: Date.now(),
    });
    await service2.selectProvider(q2.id, "w2", makeFakeToken(100));
    service2.beginWork(q2.id);

    const outcome2 = await service2.submitEscrowResult(
      q2.id,
      { attachments: [] },
      "w2",
      "test-oracle",
    );
    expect(outcome2.ok).toBe(true);
    expect(outcome2.preimage).toBe(entry2.preimage);
  });

  test("quorum split: 1 pass + 2 fail out of 3 — rejected, preimage NOT revealed", async () => {
    const oracles = [
      makeMockOracle("oracle-pass", () => true),
      makeMockOracle("oracle-fail-1", () => false),
      makeMockOracle("oracle-fail-2", () => false),
    ];

    const { service, preimageStore } = makeServiceWithPreimage({
      mockOracles: oracles,
    });

    const { escrowInfo, entry } = await makeEscrowInfo(preimageStore);
    const query = service.createQuery(
      { description: "Quorum split" },
      {
        escrow: escrowInfo,
        payment_lock: { amount_sats: 100 },
        oracleIds: ["oracle-pass", "oracle-fail-1", "oracle-fail-2"],
        quorum: { min_approvals: 2 },
      },
    );
    service.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectProvider(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      "w1",
      "oracle-pass",
    );
    // 1 pass out of 3 with min_approvals=2 — quorum not met, must reject
    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
  });

  test("all oracles unreachable — query not falsely approved", async () => {
    const store = createQueryStore();
    const registry = createOracleRegistry();
    const preimageStore = createPreimageStore();
    const service = createQueryService({
      store,
      oracleRegistry: registry,
      preimageStore,
    });

    const entry = await preimageStore.create();
    const escrowInfo = {
      type: "htlc" as const,
      hash: entry.hash,
      oracle_pubkeys: ["oracle_pub"],
      customer_pubkey: "customer_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const query = service.createQuery(
      { description: "No oracle" },
      { escrow: escrowInfo, payment_lock: { amount_sats: 100 } },
    );
    service.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectProvider(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      "w1",
      "nonexistent-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
  });
});

describe("Attack: State Machine — illegal transitions", () => {
  test("skip awaiting_offers -> verifying: submit result directly", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { escrowInfo } = await makeEscrowInfo(preimageStore);

    const query = service.createQuery(
      { description: "Skip state" },
      { escrow: escrowInfo },
    );

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not processing");
    expect(service.getQuery(query.id)?.status).toBe("awaiting_offers");
  });

  test("revert approved to processing: submit another result after approval", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query, providerPub } = await driveToProcessing(
      service,
      preimageStore,
    );

    const approval = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      providerPub,
      "test-oracle",
    );
    expect(approval.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("approved");

    const second = await service.submitEscrowResult(
      query.id,
      { attachments: [] },
      providerPub,
      "test-oracle",
    );
    expect(second.ok).toBe(false);
    expect(second.message).toContain("not processing");
    expect(service.getQuery(query.id)?.status).toBe("approved");
  });

  test("record offer on processing query fails", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query } = await driveToProcessing(service, preimageStore);

    const offerResult = service.recordOffer(query.id, {
      provider_pubkey: "w2",
      offer_event_id: "e2",
      received_at: Date.now(),
    });

    expect(offerResult.ok).toBe(false);
    expect(offerResult.message).toContain("not awaiting_offers");
  });

  test("complete verification on non-verifying query fails", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query } = await driveToProcessing(service, preimageStore);

    const result = service.completeVerification(query.id, true, "test-oracle");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not verifying");
  });
});

describe("Attack: Cross-Query", () => {
  test("provider accepted on query A tries to submit on query B — fails", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();

    const { escrowInfo: escrowInfoA, entry: entryA } = await makeEscrowInfo(
      preimageStore,
    );
    const qA = service.createQuery(
      { description: "Query A" },
      {
        escrow: escrowInfoA,
        payment_lock: { amount_sats: 100 },
        oracleIds: ["test-oracle"],
      },
    );
    service.recordOffer(qA.id, {
      provider_pubkey: "provider_a",
      offer_event_id: "eA",
      received_at: Date.now(),
    });
    await service.selectProvider(qA.id, "provider_a", makeFakeToken(100));
    service.beginWork(qA.id);

    const { escrowInfo: escrowInfoB, entry: entryB } = await makeEscrowInfo(
      preimageStore,
    );
    const qB = service.createQuery(
      { description: "Query B" },
      {
        escrow: escrowInfoB,
        payment_lock: { amount_sats: 100 },
        oracleIds: ["test-oracle"],
      },
    );
    service.recordOffer(qB.id, {
      provider_pubkey: "provider_b",
      offer_event_id: "eB",
      received_at: Date.now(),
    });
    await service.selectProvider(qB.id, "provider_b", makeFakeToken(100));
    service.beginWork(qB.id);

    const outcome = await service.submitEscrowResult(
      qB.id,
      { attachments: [] },
      "provider_a",
      "test-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("does not match");

    // Query B's state must remain unaffected by the cross-query attempt
    expect(service.getQuery(qB.id)?.status).toBe("processing");
  });
});
