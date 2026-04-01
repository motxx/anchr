/**
 * Protocol-level attack vector tests for Anchr HTLC protocol.
 *
 * Tests adversarial scenarios across five attack categories:
 *   1. Preimage Isolation — reuse, leak, re-request
 *   2. Race Conditions & Timing — cancel, expiry, double-submit
 *   3. Oracle Manipulation — dishonest oracle, flip-flop, quorum split, unreachable
 *   4. State Machine Attacks — illegal transitions
 *   5. Cross-Query Attacks — submit to wrong query
 */

import { describe, expect, test } from "bun:test";
import { getEncodedToken } from "@cashu/cashu-ts";
import { createOracleRegistry } from "./oracle/registry";
import { createPreimageStore, type PreimageStore } from "./oracle/preimage-store";
import type { Oracle, OracleAttestation } from "./oracle/types";
import { createQueryService, createQueryStore } from "./application/query-service";
import type { Query, QueryResult } from "./domain/types";
// --- Test helpers (same as protocol-trustless.test.ts) ---

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

function makeServiceWithPreimage(opts?: { mockOracle?: Oracle; mockOracles?: Oracle[] }) {
  const store = createQueryStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  if (opts?.mockOracles) {
    for (const o of opts.mockOracles) registry.register(o);
  } else {
    const oracle = opts?.mockOracle ?? makeMockOracle("test-oracle");
    registry.register(oracle);
  }
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

function makeHtlcInfo(preimageStore: PreimageStore) {
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

/** Drive query through: create -> quote -> select -> ready for result submission */
async function driveToProcessing(
  service: ReturnType<typeof createQueryService>,
  preimageStore: PreimageStore,
  opts?: { workerPubkey?: string; bountyAmount?: number; oracleIds?: string[] },
) {
  const workerPub = opts?.workerPubkey ?? "worker_pub";
  const bounty = opts?.bountyAmount ?? 100;
  const oracleIds = opts?.oracleIds ?? ["test-oracle"];
  const { htlcInfo, entry } = makeHtlcInfo(preimageStore);
  const query = service.createQuery(
    { description: "Attack test" },
    { htlc: htlcInfo, bounty: { amount_sats: bounty }, oracleIds },
  );
  service.recordQuote(query.id, {
    worker_pubkey: workerPub,
    quote_event_id: "evt_1",
    received_at: Date.now(),
  });
  const token = makeFakeToken(bounty);
  await service.selectWorker(query.id, workerPub, token);
  return { query, entry, workerPub, htlcInfo };
}

// =============================================================================
// 1. Preimage Isolation
// =============================================================================

describe("Attack: Preimage Isolation", () => {
  test("preimage reuse across queries — second query cannot re-use revealed preimage", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();

    // Create first query using entry1
    const entry1 = preimageStore.create();
    const htlcInfo1 = {
      hash: entry1.hash,
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const q1 = service.createQuery(
      { description: "Query 1" },
      { htlc: htlcInfo1, bounty: { amount_sats: 100 }, oracleIds: ["test-oracle"] },
    );
    service.recordQuote(q1.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
    await service.selectWorker(q1.id, "w1", makeFakeToken(100));

    // First query reveals preimage (deletes from store)
    const outcome1 = await service.submitHtlcResult(q1.id, { attachments: [] }, "w1", "test-oracle");
    expect(outcome1.ok).toBe(true);
    expect(outcome1.preimage).toBe(entry1.preimage);

    // Preimage is now deleted from store
    expect(preimageStore.getPreimage(entry1.hash)).toBeNull();

    // Create second query that tries to reuse the same hash
    // (attacker re-registers the same hash — but it was deleted)
    const htlcInfo2 = {
      hash: entry1.hash, // REUSED hash
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const q2 = service.createQuery(
      { description: "Query 2 reuse" },
      { htlc: htlcInfo2, bounty: { amount_sats: 100 }, oracleIds: ["test-oracle"] },
    );
    service.recordQuote(q2.id, { worker_pubkey: "w2", quote_event_id: "e2", received_at: Date.now() });
    await service.selectWorker(q2.id, "w2", makeFakeToken(100));

    // Second query verification passes but preimage was already deleted
    const outcome2 = await service.submitHtlcResult(q2.id, { attachments: [] }, "w2", "test-oracle");
    expect(outcome2.ok).toBe(true);
    // Preimage was deleted from the first query — cannot be re-revealed
    expect(outcome2.preimage).toBeUndefined();
  });

  test("preimage not leaked on rejected verification", async () => {
    const { service, preimageStore } = makeServiceWithPreimage({
      mockOracle: makeMockOracle("strict-oracle", () => false),
    });
    const { query, entry, workerPub } = await driveToProcessing(service, preimageStore, { oracleIds: ["strict-oracle"] });

    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [], notes: "garbage" },
      workerPub,
      "strict-oracle",
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
    // Preimage remains in store (not deleted) — but NOT leaked
    expect(preimageStore.getPreimage(entry.hash)).toBe(entry.preimage);
  });

  test("deleted preimage cannot be re-requested via second submitHtlcResult", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query, entry, workerPub } = await driveToProcessing(service, preimageStore);

    // First submit — preimage revealed and deleted
    const first = await service.submitHtlcResult(query.id, { attachments: [] }, workerPub, "test-oracle");
    expect(first.ok).toBe(true);
    expect(first.preimage).toBe(entry.preimage);
    expect(preimageStore.getPreimage(entry.hash)).toBeNull();

    // Second submit — query is no longer processing, so it fails
    const second = await service.submitHtlcResult(query.id, { attachments: [] }, workerPub, "test-oracle");
    expect(second.ok).toBe(false);
    expect(second.preimage).toBeUndefined();
  });
});

// =============================================================================
// 2. Race Conditions & Timing
// =============================================================================

describe("Attack: Race Conditions & Timing", () => {
  test("cancel during processing — query moves to rejected", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();

    const { htlcInfo } = makeHtlcInfo(preimageStore);
    const query = service.createQuery(
      { description: "Cancel attack" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 } },
    );
    service.recordQuote(query.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));

    // Query is now "processing" — requester cancels
    const cancel = service.cancelQuery(query.id);
    expect(cancel.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("rejected");
  });

  test("expiry during processing expires correctly", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const entry = preimageStore.create();

    const htlcInfo = {
      hash: entry.hash,
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    // Create query with very short TTL (already expired)
    const query = service.createQuery(
      { description: "Expiry attack" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 }, ttlMs: 1 },
    );
    service.recordQuote(query.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));

    // Wait a tick to ensure expiry
    await Bun.sleep(5);

    // Run expiry sweep
    const expired = service.expireQueries();
    expect(expired).toBeGreaterThanOrEqual(1);

    // Query should be expired
    expect(service.getQuery(query.id)?.status).toBe("expired");
  });

  test("submit result to expired query fails", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const entry = preimageStore.create();

    const htlcInfo = {
      hash: entry.hash,
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const query = service.createQuery(
      { description: "Expired submit" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 }, ttlMs: 1 },
    );
    service.recordQuote(query.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));

    await Bun.sleep(5);
    service.expireQueries();

    // Worker tries to submit result after expiry
    const outcome = await service.submitHtlcResult(query.id, { attachments: [] }, "w1", "test-oracle");
    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
  });

  test("double-submit by worker — second attempt fails, first preimage valid", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query, entry, workerPub } = await driveToProcessing(service, preimageStore);

    const first = await service.submitHtlcResult(query.id, { attachments: [] }, workerPub, "test-oracle");
    expect(first.ok).toBe(true);
    expect(first.preimage).toBe(entry.preimage);

    const second = await service.submitHtlcResult(query.id, { attachments: [] }, workerPub, "test-oracle");
    expect(second.ok).toBe(false);
    expect(second.message).toContain("not processing");
    expect(second.preimage).toBeUndefined();
  });
});


// =============================================================================
// 3. Oracle Manipulation
// =============================================================================

describe("Attack: Oracle Manipulation", () => {
  test("dishonest oracle approves garbage — preimage still revealed (oracle judgment is final)", async () => {
    // Oracle always passes, even for garbage input
    const { service, preimageStore } = makeServiceWithPreimage({
      mockOracle: makeMockOracle("rubber-stamp", () => true),
    });
    const { query, entry, workerPub } = await driveToProcessing(service, preimageStore, { oracleIds: ["rubber-stamp"] });

    // Worker submits completely empty result
    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [], notes: "" },
      workerPub,
      "rubber-stamp",
    );

    // Protocol correctness: oracle's judgment is final
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBe(entry.preimage);
  });

  test("oracle flip-flop — first rejects, new query with fresh preimage works", async () => {
    // First oracle rejects
    const { service, preimageStore } = makeServiceWithPreimage({
      mockOracle: makeMockOracle("flip-oracle", () => false),
    });

    const { htlcInfo: htlcInfo1 } = makeHtlcInfo(preimageStore);
    const q1 = service.createQuery(
      { description: "Flip-flop Q1" },
      { htlc: htlcInfo1, bounty: { amount_sats: 100 }, oracleIds: ["flip-oracle"] },
    );
    service.recordQuote(q1.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
    await service.selectWorker(q1.id, "w1", makeFakeToken(100));

    const outcome1 = await service.submitHtlcResult(q1.id, { attachments: [] }, "w1", "flip-oracle");
    expect(outcome1.ok).toBe(false);
    expect(outcome1.preimage).toBeUndefined();

    // Requester can create new query with new preimage using a passing oracle
    const { service: service2, preimageStore: ps2 } = makeServiceWithPreimage();

    const { htlcInfo: htlcInfo2, entry: entry2 } = makeHtlcInfo(ps2);
    const q2 = service2.createQuery(
      { description: "Flip-flop Q2" },
      { htlc: htlcInfo2, bounty: { amount_sats: 100 }, oracleIds: ["test-oracle"] },
    );
    service2.recordQuote(q2.id, { worker_pubkey: "w2", quote_event_id: "e2", received_at: Date.now() });
    await service2.selectWorker(q2.id, "w2", makeFakeToken(100));

    const outcome2 = await service2.submitHtlcResult(q2.id, { attachments: [] }, "w2", "test-oracle");
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

    const { htlcInfo, entry } = makeHtlcInfo(preimageStore);
    const query = service.createQuery(
      { description: "Quorum split" },
      {
        htlc: htlcInfo,
        bounty: { amount_sats: 100 },
        oracleIds: ["oracle-pass", "oracle-fail-1", "oracle-fail-2"],
        quorum: { min_approvals: 2 },
      },
    );
    service.recordQuote(query.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));

    const outcome = await service.submitHtlcResult(query.id, { attachments: [] }, "w1", "oracle-pass");
    // 1 pass out of 3, need 2 — rejected
    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
  });

  test("all oracles unreachable — query not falsely approved", async () => {
    // No oracles registered at all
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    // Deliberately register NO oracles
    const preimageStore = createPreimageStore();
    const service = createQueryService({ store, oracleRegistry: registry, preimageStore });

    const entry = preimageStore.create();
    const htlcInfo = {
      hash: entry.hash,
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const query = service.createQuery(
      { description: "No oracle" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 } },
    );
    service.recordQuote(query.id, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));

    // Pass a nonexistent oracle ID
    const outcome = await service.submitHtlcResult(query.id, { attachments: [] }, "w1", "nonexistent-oracle");
    // The verification should fail because no oracle is available
    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
  });
});

// =============================================================================
// 4. State Machine Attacks
// =============================================================================

describe("Attack: State Machine — illegal transitions", () => {
  test("skip awaiting_quotes -> verifying: submit result directly", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    const query = service.createQuery(
      { description: "Skip state" },
      { htlc: htlcInfo },
    );

    // Query is in awaiting_quotes — try to submit result (should need processing)
    const outcome = await service.submitHtlcResult(query.id, { attachments: [] }, "w1", "test-oracle");
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not processing");
    expect(service.getQuery(query.id)?.status).toBe("awaiting_quotes");
  });

  test("revert approved to processing: submit another result after approval", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query, workerPub } = await driveToProcessing(service, preimageStore);

    // Get approval
    const approval = await service.submitHtlcResult(query.id, { attachments: [] }, workerPub, "test-oracle");
    expect(approval.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("approved");

    // Try to submit again (revert to processing)
    const second = await service.submitHtlcResult(query.id, { attachments: [] }, workerPub, "test-oracle");
    expect(second.ok).toBe(false);
    expect(second.message).toContain("not processing");
    expect(service.getQuery(query.id)?.status).toBe("approved");
  });

  test("record quote on processing query fails", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query } = await driveToProcessing(service, preimageStore);

    // Query is in processing — try to add another quote
    const quoteResult = service.recordQuote(query.id, {
      worker_pubkey: "w2",
      quote_event_id: "e2",
      received_at: Date.now(),
    });

    expect(quoteResult.ok).toBe(false);
    expect(quoteResult.message).toContain("not awaiting_quotes");
  });

  test("complete verification on non-verifying query fails", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query } = await driveToProcessing(service, preimageStore);

    // Query is in "processing" — try to complete verification (needs "verifying")
    const result = service.completeVerification(query.id, true, "test-oracle");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not verifying");
  });
});

// =============================================================================
// 5. Cross-Query Attacks
// =============================================================================

describe("Attack: Cross-Query", () => {
  test("worker accepted on query A tries to submit on query B — fails", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();

    // Create query A with worker_a
    const { htlcInfo: htlcInfoA, entry: entryA } = makeHtlcInfo(preimageStore);
    const qA = service.createQuery(
      { description: "Query A" },
      { htlc: htlcInfoA, bounty: { amount_sats: 100 }, oracleIds: ["test-oracle"] },
    );
    service.recordQuote(qA.id, { worker_pubkey: "worker_a", quote_event_id: "eA", received_at: Date.now() });
    await service.selectWorker(qA.id, "worker_a", makeFakeToken(100));

    // Create query B with worker_b
    const { htlcInfo: htlcInfoB, entry: entryB } = makeHtlcInfo(preimageStore);
    const qB = service.createQuery(
      { description: "Query B" },
      { htlc: htlcInfoB, bounty: { amount_sats: 100 }, oracleIds: ["test-oracle"] },
    );
    service.recordQuote(qB.id, { worker_pubkey: "worker_b", quote_event_id: "eB", received_at: Date.now() });
    await service.selectWorker(qB.id, "worker_b", makeFakeToken(100));

    // Worker A tries to submit result on query B
    const outcome = await service.submitHtlcResult(qB.id, { attachments: [] }, "worker_a", "test-oracle");
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("does not match");

    // Query B still in processing — not corrupted
    expect(service.getQuery(qB.id)?.status).toBe("processing");
  });

});
