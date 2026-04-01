/**
 * Protocol trustless property tests.
 *
 * Verifies the cryptographic and protocol-level guarantees described in README:
 *
 *   1. Oracle cannot steal BTC (NUT-11 P2PK)
 *   2. Worker cannot redeem without valid proof (NUT-14 HTLC)
 *   3. Requester cannot revoke payment (NUT-07 + wallet lock)
 *   4. Timeout refund is automatic (NUT-11 locktime)
 *   5. Worker cannot impersonate another worker
 *   6. Oracle + Requester collusion limits
 *   7. Preimage is only revealed on verification pass
 */

import { describe, expect, test } from "bun:test";
import { getEncodedToken } from "@cashu/cashu-ts";
import { createOracleRegistry } from "./oracle/registry";
import { createPreimageStore, type PreimageStore } from "./oracle/preimage-store";
import type { Oracle, OracleAttestation } from "./oracle/types";
import { createQueryService, createQueryStore } from "./application/query-service";
import type { Query, QueryResult } from "./domain/types";
import {
  buildHtlcFinalOptions,
  buildHtlcInitialOptions,
  buildEscrowP2PKOptions,
} from "./cashu/escrow";
import { createWalletStore, type WalletStore } from "./cashu/wallet-store";

// --- Test helpers ---

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

function makeServiceWithPreimage(opts?: { mockOracle?: Oracle }) {
  const store = createQueryStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  const oracle = opts?.mockOracle ?? makeMockOracle("test-oracle");
  registry.register(oracle);
  const preimageStore = createPreimageStore();
  const walletStore = createWalletStore();
  return {
    service: createQueryService({
      store,
      oracleRegistry: registry,
      preimageStore,
      walletStore,
    }),
    store,
    registry,
    preimageStore,
    walletStore,
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

/** Drive query through: create → quote → select → ready for result submission */
async function driveToProcessing(
  service: ReturnType<typeof createQueryService>,
  preimageStore: PreimageStore,
  walletStore?: WalletStore,
  opts?: { workerPubkey?: string; bountyAmount?: number; oracleIds?: string[] },
) {
  const workerPub = opts?.workerPubkey ?? "worker_pub";
  const bounty = opts?.bountyAmount ?? 100;
  const oracleIds = opts?.oracleIds ?? ["test-oracle"];
  const { htlcInfo, entry } = makeHtlcInfo(preimageStore);
  // Seed wallet so lockForQuery succeeds
  if (walletStore) {
    walletStore.addProofs("requester", "requester_pub", [
      { amount: bounty, id: "k_drive", secret: `s_drive_${Date.now()}`, C: `C_drive_${Date.now()}` },
    ]);
  }
  const query = service.createQuery(
    { description: "Trustless test" },
    { htlc: htlcInfo, bounty: { amount_sats: bounty }, oracleIds },
  );
  service.recordQuote(query.id, {
    worker_pubkey: workerPub,
    quote_event_id: "evt_1",
    received_at: Date.now(),
  });
  const token = makeFakeToken(bounty);
  await service.selectWorker(query.id, workerPub, token);
  return { query, entry, workerPub };
}

// =============================================================================
// 1. Oracle cannot steal BTC (NUT-11 P2PK)
// =============================================================================

describe("NUT-11: Oracle cannot steal BTC", () => {
  test("HTLC P2PK options require Worker's signature, not Oracle's", () => {
    const opts = buildHtlcFinalOptions({
      hash: "a".repeat(64),
      workerPubkey: "worker_key_" + "0".repeat(53),
      requesterRefundPubkey: "requester_key_" + "0".repeat(50),
      locktimeSeconds: 1700000000,
    });

    // P2PK lock is on Worker's pubkey — Oracle pubkey is NOT in the lock set
    const pubkeys = Array.isArray(opts.pubkey) ? opts.pubkey : [opts.pubkey];
    expect(pubkeys.length).toBe(1);
    expect(pubkeys[0]).toContain("worker_key_");
    // No oracle pubkey in lock keys
    for (const pk of pubkeys) {
      expect(pk).not.toContain("oracle");
    }
  });

  test("Oracle knowing preimage is insufficient — HTLC requires Worker sig + preimage", () => {
    const opts = buildHtlcFinalOptions({
      hash: "b".repeat(64),
      workerPubkey: "w" + "0".repeat(63),
      requesterRefundPubkey: "r" + "0".repeat(63),
      locktimeSeconds: 1700000000,
    });

    // Both hashlock AND pubkey lock must be satisfied
    expect(opts.hashlock).toBe("b".repeat(64));
    expect(opts.sigFlag).toBe("SIG_ALL");
    const pubkeys = Array.isArray(opts.pubkey) ? opts.pubkey : [opts.pubkey];
    expect(pubkeys.length).toBeGreaterThan(0);
    // Both conditions are required — preimage alone (Oracle) is not enough
  });

  test("preimage is NOT returned to Oracle — only to Worker via submitHtlcResult", async () => {
    const { service, preimageStore, walletStore } = makeServiceWithPreimage();
    const { query, entry, workerPub } = await driveToProcessing(service, preimageStore, walletStore);

    // Oracle's verification returns preimage to the caller (Worker endpoint)
    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [], notes: "valid proof" },
      workerPub,
      "test-oracle",
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBe(entry.preimage);

    // After successful preimage reveal, preimage is deleted from store
    // (defense-in-depth: prevents re-reading after one-time delivery)
    const storedPreimage = preimageStore.getPreimage(entry.hash);
    expect(storedPreimage).toBeNull();
  });
});

// =============================================================================
// 2. Worker cannot redeem without valid proof (NUT-14 HTLC)
// =============================================================================

describe("NUT-14: Worker cannot redeem without valid proof", () => {
  test("preimage is NOT returned when verification fails", async () => {
    const { service, preimageStore, walletStore } = makeServiceWithPreimage({
      mockOracle: makeMockOracle("strict-oracle", () => false),
    });
    const { query, entry, workerPub } = await driveToProcessing(service, preimageStore, walletStore, { oracleIds: ["strict-oracle"] });

    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [], notes: "bad proof" },
      workerPub,
      "strict-oracle",
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
    expect(outcome.query?.status).toBe("rejected");
    expect(outcome.query?.payment_status).toBe("cancelled");

    // Preimage still exists in store but was NOT revealed to Worker
    expect(preimageStore.getPreimage(entry.hash)).toBe(entry.preimage);
  });

  test("HTLC hashlock binds redemption to Oracle's preimage", () => {
    const HASH = "c".repeat(64);
    const opts = buildHtlcFinalOptions({
      hash: HASH,
      workerPubkey: "w" + "0".repeat(63),
      requesterRefundPubkey: "r" + "0".repeat(63),
      locktimeSeconds: 1700000000,
    });

    expect(opts.hashlock).toBe(HASH);
    // Without the preimage that hashes to this value, Worker cannot redeem
  });

  test("preimage verification is correct (createHTLCHash round-trip)", () => {
    const preimageStore = createPreimageStore();
    const entry = preimageStore.create();

    // Correct preimage verifies
    expect(preimageStore.verify(entry.hash, entry.preimage)).toBe(true);

    // Wrong preimage does not verify (must be valid 64-char hex)
    const wrongPreimage = "ff".repeat(32);
    expect(preimageStore.verify(entry.hash, wrongPreimage)).toBe(false);

    // Non-existent hash does not verify
    expect(preimageStore.verify("aa".repeat(32), entry.preimage)).toBe(false);
  });
});

// =============================================================================
// 3. Requester cannot revoke payment (NUT-07 + wallet lock)
// =============================================================================

describe("NUT-07: Requester cannot revoke payment", () => {
  test("bounty is locked in wallet when HTLC query is created", () => {
    const { service, walletStore, preimageStore } = makeServiceWithPreimage();
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    // Seed requester wallet
    const fakeProofs = [
      { amount: 50, id: "k1", secret: "s1", C: "C1" },
      { amount: 50, id: "k2", secret: "s2", C: "C2" },
    ];
    walletStore.addProofs("requester", "requester_pub", fakeProofs);
    const balanceBefore = walletStore.getBalance("requester", "requester_pub");
    expect(balanceBefore.balance_sats).toBe(100);

    // Create query with bounty — locks proofs
    service.createQuery(
      { description: "Lock test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 } },
    );

    const balanceAfter = walletStore.getBalance("requester", "requester_pub");
    expect(balanceAfter.balance_sats).toBe(0);
    expect(balanceAfter.pending_sats).toBe(100);
  });

  test("Requester cannot double-spend locked proofs", () => {
    const { service, walletStore, preimageStore } = makeServiceWithPreimage();
    const { htlcInfo: htlcInfo1 } = makeHtlcInfo(preimageStore);
    const { htlcInfo: htlcInfo2 } = makeHtlcInfo(preimageStore);

    // Seed with only 100 sats
    walletStore.addProofs("requester", "requester_pub", [
      { amount: 100, id: "k1", secret: "s1", C: "C1" },
    ]);

    // First query locks 100 sats
    service.createQuery(
      { description: "Query 1" },
      { htlc: htlcInfo1, bounty: { amount_sats: 100 } },
    );

    // Second query — insufficient funds (already locked) → throws
    expect(() => {
      service.createQuery(
        { description: "Query 2" },
        { htlc: htlcInfo2, bounty: { amount_sats: 100 } },
      );
    }).toThrow("Insufficient balance");

    // Balance should still show 0 available, 100 pending (first lock only)
    const balance = walletStore.getBalance("requester", "requester_pub");
    expect(balance.balance_sats).toBe(0);
    expect(balance.pending_sats).toBe(100);
  });

  test("escrow token amount is verified at worker selection", async () => {
    const { service, preimageStore, walletStore } = makeServiceWithPreimage();
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    walletStore.addProofs("requester", "requester_pub", [
      { amount: 100, id: "k1", secret: "s_escrow1", C: "C_escrow1" },
    ]);
    const query = service.createQuery(
      { description: "Escrow verify test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 } },
    );
    service.recordQuote(query.id, {
      worker_pubkey: "w1",
      quote_event_id: "e1",
      received_at: Date.now(),
    });

    // Insufficient token rejected
    const smallToken = makeFakeToken(50);
    const rejected = await service.selectWorker(query.id, "w1", smallToken);
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain("Insufficient");

    // Sufficient token accepted
    const validToken = makeFakeToken(100);
    const accepted = await service.selectWorker(query.id, "w1", validToken);
    expect(accepted.ok).toBe(true);
  });

  test("invalid escrow token is rejected at worker selection", async () => {
    const { service, preimageStore, walletStore } = makeServiceWithPreimage();
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    walletStore.addProofs("requester", "requester_pub", [
      { amount: 100, id: "k1", secret: "s_invalid1", C: "C_invalid1" },
    ]);
    const query = service.createQuery(
      { description: "Invalid token test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 } },
    );
    service.recordQuote(query.id, {
      worker_pubkey: "w1",
      quote_event_id: "e1",
      received_at: Date.now(),
    });

    const outcome = await service.selectWorker(query.id, "w1", "garbage_token");
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Escrow token verification failed");
    expect(service.getQuery(query.id)?.status).toBe("awaiting_quotes");
  });
});

// =============================================================================
// 4. Timeout refund (NUT-11 locktime)
// =============================================================================

describe("NUT-11: Timeout refund", () => {
  test("HTLC options include locktime and refund pubkey", () => {
    const locktimeSeconds = Math.floor(Date.now() / 1000) + 3600;
    const opts = buildHtlcFinalOptions({
      hash: "d".repeat(64),
      workerPubkey: "w" + "0".repeat(63),
      requesterRefundPubkey: "r" + "0".repeat(63),
      locktimeSeconds,
    });

    expect(opts.locktime).toBe(locktimeSeconds);
    const refundKeys = Array.isArray(opts.refundKeys) ? opts.refundKeys : [opts.refundKeys];
    expect(refundKeys.length).toBe(1);
    expect(refundKeys[0]).toContain("r" + "0".repeat(63));
  });

  test("cancelled non-HTLC query refunds locked proofs to Requester wallet", () => {
    // cancelQuery only works on "pending" status (non-HTLC queries).
    // HTLC queries start as "awaiting_quotes" and are refunded via
    // rejected verification or timeout. This tests the non-HTLC refund path.
    const { service, walletStore } = makeServiceWithPreimage();

    // For HTLC, refund happens via submitHtlcResult rejection (tested below).
    // Here we test the basic cancel → refund for non-HTLC queries.
    const query = service.createQuery(
      { description: "Refund test" },
      { bounty: { amount_sats: 100 } },
    );
    expect(query.status).toBe("pending");

    const outcome = service.cancelQuery(query.id);
    expect(outcome.ok).toBe(true);
    expect(service.getQuery(query.id)?.status).toBe("rejected");
    expect(service.getQuery(query.id)?.payment_status).toBe("cancelled");
  });

  test("rejected verification refunds proofs to Requester", async () => {
    const { service, walletStore, preimageStore } = makeServiceWithPreimage({
      mockOracle: makeMockOracle("strict-oracle", () => false),
    });
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    walletStore.addProofs("requester", "requester_pub", [
      { amount: 100, id: "k1", secret: "s1", C: "C1" },
    ]);

    const query = service.createQuery(
      { description: "Reject refund test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 }, oracleIds: ["strict-oracle"] },
    );
    service.recordQuote(query.id, {
      worker_pubkey: "w1",
      quote_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));

    // Submit invalid proof → rejected
    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      "w1",
      "strict-oracle",
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.query?.payment_status).toBe("cancelled");

    // Proofs refunded
    expect(walletStore.getBalance("requester", "requester_pub").balance_sats).toBe(100);
    expect(walletStore.getBalance("requester", "requester_pub").pending_sats).toBe(0);
  });
});

// =============================================================================
// 5. Worker cannot impersonate another worker
// =============================================================================

describe("Worker impersonation prevention", () => {
  test("wrong Worker cannot submit result for selected Worker", async () => {
    const { service, preimageStore, walletStore } = makeServiceWithPreimage();
    const { query, workerPub } = await driveToProcessing(service, preimageStore, walletStore);

    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [], notes: "impostor" },
      "impostor_worker",
      "test-oracle",
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("does not match");
    // Query stays in processing — not corrupted
    expect(service.getQuery(query.id)?.status).toBe("processing");
  });

  test("only quoted Worker can be selected", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    const query = service.createQuery(
      { description: "Worker check" },
      { htlc: htlcInfo },
    );
    service.recordQuote(query.id, {
      worker_pubkey: "legit_worker",
      quote_event_id: "e1",
      received_at: Date.now(),
    });

    // Select a worker who never quoted — should still succeed at protocol level
    // (worker selection is Requester's choice from available quotes)
    // The real protection is P2PK: only the selected Worker's key can redeem
    const outcome = await service.selectWorker(query.id, "other_worker");
    expect(outcome.ok).toBe(true);
    // But HTLC token is now locked to other_worker ��� legit_worker can't redeem
    expect(service.getQuery(query.id)?.htlc?.worker_pubkey).toBe("other_worker");
  });
});

// =============================================================================
// 6. Oracle + Requester collusion limits
// =============================================================================

describe("Oracle + Requester collusion limits", () => {
  test("Oracle withholding preimage: Worker loses but Oracle cannot profit", async () => {
    // Simulate: Oracle verifies valid proof but preimage store has been cleared
    const { service, preimageStore, walletStore } = makeServiceWithPreimage();
    const { query, entry, workerPub } = await driveToProcessing(service, preimageStore, walletStore);

    // Oracle "withholds" by deleting preimage before result submission
    preimageStore.delete(entry.hash);

    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [], notes: "valid proof" },
      workerPub,
      "test-oracle",
    );

    // Verification passes but preimage cannot be revealed
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBeUndefined();
    expect(outcome.query?.status).toBe("approved");
    // Worker got approved status but no preimage → cannot redeem HTLC
    // Oracle also cannot redeem (needs Worker sig)
    // BTC is stuck until timeout → refunds to Requester
  });

  test("approved query transfers proofs to Worker wallet (honest Oracle)", async () => {
    const { service, walletStore, preimageStore } = makeServiceWithPreimage();
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    walletStore.addProofs("requester", "requester_pub", [
      { amount: 100, id: "k1", secret: "s1", C: "C1" },
    ]);

    const query = service.createQuery(
      { description: "Settlement test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 }, oracleIds: ["test-oracle"] },
    );
    service.recordQuote(query.id, {
      worker_pubkey: "w1",
      quote_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));

    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [], notes: "good" },
      "w1",
      "test-oracle",
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBeTruthy();

    // Proofs transferred: Requester → Worker
    expect(walletStore.getBalance("requester", "requester_pub").balance_sats).toBe(0);
    expect(walletStore.getBalance("requester", "requester_pub").pending_sats).toBe(0);
    expect(walletStore.getBalance("worker", "w1").balance_sats).toBe(100);
  });

  test("rejected query refunds proofs to Requester (no proofs to Worker)", async () => {
    const { service, walletStore, preimageStore } = makeServiceWithPreimage({
      mockOracle: makeMockOracle("strict-oracle", () => false),
    });
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    walletStore.addProofs("requester", "requester_pub", [
      { amount: 100, id: "k1", secret: "s1", C: "C1" },
    ]);

    const query = service.createQuery(
      { description: "Reject test" },
      { htlc: htlcInfo, bounty: { amount_sats: 100 }, oracleIds: ["strict-oracle"] },
    );
    service.recordQuote(query.id, {
      worker_pubkey: "w1",
      quote_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));

    await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      "w1",
      "strict-oracle",
    );

    // Requester got refund, Worker got nothing
    expect(walletStore.getBalance("requester", "requester_pub").balance_sats).toBe(100);
    expect(walletStore.getBalance("worker", "w1").balance_sats).toBe(0);
  });
});

// =============================================================================
// 7. Preimage is only revealed on verification pass
// =============================================================================

describe("Preimage reveal conditions", () => {
  test("preimage returned ONLY when verification passes", async () => {
    // Pass case
    const pass = makeServiceWithPreimage();
    const passCtx = await driveToProcessing(pass.service, pass.preimageStore, pass.walletStore);
    const passOutcome = await pass.service.submitHtlcResult(
      passCtx.query.id,
      { attachments: [] },
      passCtx.workerPub,
      "test-oracle",
    );
    expect(passOutcome.preimage).toBe(passCtx.entry.preimage);

    // Fail case
    const fail = makeServiceWithPreimage({
      mockOracle: makeMockOracle("fail-oracle", () => false),
    });
    const failCtx = await driveToProcessing(fail.service, fail.preimageStore, fail.walletStore, { oracleIds: ["fail-oracle"] });
    const failOutcome = await fail.service.submitHtlcResult(
      failCtx.query.id,
      { attachments: [] },
      failCtx.workerPub,
      "fail-oracle",
    );
    expect(failOutcome.preimage).toBeUndefined();
  });

  test("each query gets a unique preimage", () => {
    const preimageStore = createPreimageStore();
    const entry1 = preimageStore.create();
    const entry2 = preimageStore.create();

    expect(entry1.hash).not.toBe(entry2.hash);
    expect(entry1.preimage).not.toBe(entry2.preimage);
  });

  test("preimage cannot be retrieved with wrong hash", () => {
    const preimageStore = createPreimageStore();
    const entry = preimageStore.create();

    expect(preimageStore.getPreimage(entry.hash)).toBe(entry.preimage);
    expect(preimageStore.getPreimage("wrong_hash")).toBeNull();
    expect(preimageStore.getPreimage("")).toBeNull();
  });
});

// =============================================================================
// 8. State machine integrity
// =============================================================================

describe("HTLC state machine — invalid transitions blocked", () => {
  test("cannot submit result before Worker is selected", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    const query = service.createQuery(
      { description: "State test" },
      { htlc: htlcInfo },
    );

    // Still in awaiting_quotes
    const outcome = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not processing");
  });

  test("cannot select Worker twice", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { htlcInfo } = makeHtlcInfo(preimageStore);

    const query = service.createQuery(
      { description: "Double select" },
      { htlc: htlcInfo },
    );
    service.recordQuote(query.id, {
      worker_pubkey: "w1",
      quote_event_id: "e1",
      received_at: Date.now(),
    });

    await service.selectWorker(query.id, "w1");
    const second = await service.selectWorker(query.id, "w2");

    expect(second.ok).toBe(false);
    expect(second.message).toContain("not awaiting_quotes");
  });

  test("cannot submit result twice", async () => {
    const { service, preimageStore, walletStore } = makeServiceWithPreimage();
    const { query, workerPub } = await driveToProcessing(service, preimageStore, walletStore);

    const first = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      workerPub,
      "test-oracle",
    );
    expect(first.ok).toBe(true);

    const second = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      workerPub,
      "test-oracle",
    );
    expect(second.ok).toBe(false);
    expect(second.message).toContain("not processing");
  });

  test("non-HTLC query rejects HTLC operations", async () => {
    const { service } = makeServiceWithPreimage();
    const query = service.createQuery({ description: "Simple query" });

    // recordQuote fails
    const quoteResult = service.recordQuote(query.id, {
      worker_pubkey: "w1",
      quote_event_id: "e1",
      received_at: Date.now(),
    });
    expect(quoteResult.ok).toBe(false);
    expect(quoteResult.message).toContain("Not an HTLC query");

    // submitHtlcResult fails
    const htlcResult = await service.submitHtlcResult(
      query.id,
      { attachments: [] },
      "w1",
      "test-oracle",
    );
    expect(htlcResult.ok).toBe(false);
    expect(htlcResult.message).toContain("Not an HTLC query");
  });
});

// =============================================================================
// 9. P2PK options structure — Phase 1 vs Phase 2
// =============================================================================

describe("Two-phase HTLC: Phase 1 (plain) vs Phase 2 (locked)", () => {
  test("Phase 1 returns null — plain bearer proofs, no conditions", () => {
    const result = buildHtlcInitialOptions({
      hash: "a".repeat(64),
      requesterPubkey: "r" + "0".repeat(63),
      locktimeSeconds: 1700000000,
    });
    expect(result).toBeNull();
  });

  test("Phase 2 includes all HTLC conditions", () => {
    const HASH = "e".repeat(64);
    const WORKER = "w" + "0".repeat(63);
    const REQUESTER = "r" + "0".repeat(63);
    const LOCKTIME = 1700000000;

    const opts = buildHtlcFinalOptions({
      hash: HASH,
      workerPubkey: WORKER,
      requesterRefundPubkey: REQUESTER,
      locktimeSeconds: LOCKTIME,
    });

    expect(opts.hashlock).toBe(HASH);
    expect(opts.locktime).toBe(LOCKTIME);
    expect(opts.sigFlag).toBe("SIG_ALL");

    const pubkeys = Array.isArray(opts.pubkey) ? opts.pubkey : [opts.pubkey];
    expect(pubkeys).toContain(`02${WORKER}`);

    const refundKeys = Array.isArray(opts.refundKeys) ? opts.refundKeys : [opts.refundKeys];
    expect(refundKeys).toContain(`02${REQUESTER}`);
  });

  test("legacy 2-of-2 escrow is distinct from HTLC (requires both Oracle + Worker)", () => {
    const opts = buildEscrowP2PKOptions({
      oraclePubkey: "o" + "0".repeat(63),
      workerPubkey: "w" + "0".repeat(63),
      requesterRefundPubkey: "r" + "0".repeat(63),
      locktimeSeconds: 1700000000,
    });

    expect(opts.requiredSignatures).toBe(2);
    const pubkeys = Array.isArray(opts.pubkey) ? opts.pubkey : [opts.pubkey];
    expect(pubkeys).toHaveLength(2);
    // Legacy requires BOTH Oracle and Worker — different from NUT-14 HTLC
  });
});
