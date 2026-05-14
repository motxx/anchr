import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getEncodedToken } from "@cashu/cashu-ts";
import { createOracleRegistry } from "../../packages/bounty/src/infrastructure/oracle-client/registry.ts";
import { createPreimageStore } from "@anchr/core-cashu/preimage-store";
import {
  createQueryService,
  createQueryStore,
} from "../../packages/bounty/src/application/query-service.ts";
import { MIN_ESCROW_LOCKTIME_SECS } from "../../packages/bounty/src/application/query-escrow-validation.ts";
import {
  makeFakeToken,
  makeMockOracle,
  makeServiceWithPreimage as makeExploitService,
} from "../../packages/bounty/src/testing/protocol-helpers.ts";

describe("VULN-1: Preimage is returned on successful oracle verification", () => {
  test("preimage is returned when oracle verification passes", async () => {
    const { service, preimageStore } = makeExploitService();
    const entry = preimageStore.create();
    const escrowInfo = {
      type: "htlc" as const,
      hash: entry.hash,
      oracle_pubkeys: ["oracle_pub"],
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    };

    const query = service.createQuery(
      { description: "Preimage reveal test" },
      {
        escrow: escrowInfo,
        bounty: { amount_sats: 100 },
        oracleIds: ["test-oracle"],
      },
    );
    service.recordOffer(query.id, {
      worker_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [], notes: "valid result" },
      "w1",
      "test-oracle",
    );

    // Atomic settlement: HTLC enforcement happens at the Cashu Mint per NUT-14
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBe(entry.preimage);
  });
});

describe("End-to-end settlement: preimage reveal on oracle approval", () => {
  test("successful oracle verification returns preimage and marks query approved", async () => {
    const { service, preimageStore } = makeExploitService();
    const entry = preimageStore.create();

    const query = service.createQuery(
      { description: "E2E settlement test" },
      {
        escrow: {
          type: "htlc",
          hash: entry.hash,
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "requester_pub",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
        bounty: { amount_sats: 100 },
        oracleIds: ["test-oracle"],
      },
    );
    service.recordOffer(query.id, {
      worker_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [], notes: "valid result" },
      "w1",
      "test-oracle",
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBe(entry.preimage);
    expect(outcome.query?.status).toBe("approved");
  });
});

describe("CTF-1: Worker forces dishonest oracle selection", () => {
  test("BLOCKED: worker-supplied oracle_id is ignored when query has no oracle_ids", async () => {
    // Registry contains built-in (rejects) AND evil oracle (always passes); the
    // attack is to see whether worker-supplied oracle_id can override built-in selection
    const store = createQueryStore();
    const registry = createOracleRegistry();
    const evilOracle = makeMockOracle("evil-oracle", () => true);
    registry.register(evilOracle);
    const preimageStore = createPreimageStore();
    const service = createQueryService({
      store,
      oracleRegistry: registry,
      preimageStore,
    });

    const entry = preimageStore.create();

    const query = service.createQuery(
      { description: "CTF-1 exploit" },
      {
        escrow: {
          type: "htlc",
          hash: entry.hash,
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "req_pub",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
        bounty: { amount_sats: 100 },
      },
    );
    expect(query.oracle_ids).toBeUndefined();

    service.recordOffer(query.id, {
      worker_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [], notes: "exploit attempt" },
      "w1",
      "evil-oracle",
    );

    expect(outcome.query?.assigned_oracle_id).toBe("built-in");
  });

  test("ALLOWED: worker-supplied oracle_id is used when query explicitly allows it", async () => {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle1 = makeMockOracle("oracle-a", () => true);
    const oracle2 = makeMockOracle("oracle-b", () => true);
    registry.register(oracle1);
    registry.register(oracle2);
    const preimageStore = createPreimageStore();
    const service = createQueryService({
      store,
      oracleRegistry: registry,
      preimageStore,
    });

    const entry = preimageStore.create();

    const query = service.createQuery(
      { description: "CTF-1 allowed" },
      {
        escrow: {
          type: "htlc",
          hash: entry.hash,
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "req_pub",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
        bounty: { amount_sats: 100 },
        oracleIds: ["oracle-a", "oracle-b"],
      },
    );
    expect(query.oracle_ids).toEqual(["oracle-a", "oracle-b"]);

    service.recordOffer(query.id, {
      worker_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [], notes: "legit" },
      "w1",
      "oracle-b",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.query?.assigned_oracle_id).toBe("oracle-b");
  });

  test("BLOCKED: worker cannot use unregistered oracle even via oracle_id param", async () => {
    const store = createQueryStore();
    const registry = createOracleRegistry({ skipBuiltIn: true });
    registry.register(makeMockOracle("legit-oracle"));
    const preimageStore = createPreimageStore();
    const service = createQueryService({
      store,
      oracleRegistry: registry,
      preimageStore,
    });

    const entry = preimageStore.create();

    const query = service.createQuery(
      { description: "CTF-1 unregistered" },
      {
        escrow: {
          type: "htlc",
          hash: entry.hash,
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "req_pub",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
        bounty: { amount_sats: 100 },
        oracleIds: ["legit-oracle"],
      },
    );

    service.recordOffer(query.id, {
      worker_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await service.selectWorker(query.id, "w1", makeFakeToken(100));
    service.beginWork(query.id);

    const outcome = await service.submitEscrowResult(
      query.id,
      { attachments: [], notes: "exploit" },
      "w1",
      "not-in-list-oracle",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not available or not accepted");
  });
});

describe("CTF-2: Requester submits self-locked HTLC token", () => {
  function makeHtlcToken(
    amountSats: number,
    hash: string,
    lockedPubkey: string,
  ): string {
    const htlcSecret = JSON.stringify([
      "HTLC",
      {
        data: hash,
        nonce: "0000",
        tags: [["pubkeys", lockedPubkey]],
      },
    ]);
    return getEncodedToken({
      mint: "https://mint.example.com",
      proofs: [{
        amount: amountSats,
        id: "test",
        secret: htlcSecret,
        C: "C_htlc",
      }],
    });
  }

  test("BLOCKED: token locked to requester (not worker) is rejected", async () => {
    const { service, preimageStore } = makeExploitService();
    const entry = preimageStore.create();

    const query = service.createQuery(
      { description: "CTF-2 exploit" },
      {
        escrow: {
          type: "htlc",
          hash: entry.hash,
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "req_pub",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
        bounty: { amount_sats: 100 },
      },
    );
    service.recordOffer(query.id, {
      worker_pubkey: "02worker_hex_pubkey",
      offer_event_id: "e1",
      received_at: Date.now(),
    });

    // Self-locked HTLC: token locked to requester pubkey, not the selected worker
    const selfLockedToken = makeHtlcToken(
      100,
      entry.hash,
      "02requester_hex_pubkey",
    );

    const result = await service.selectWorker(
      query.id,
      "02worker_hex_pubkey",
      selfLockedToken,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not locked to selected worker");
  });

  test("ALLOWED: token locked to worker passes verification", async () => {
    const { service, preimageStore } = makeExploitService();
    const entry = preimageStore.create();

    const query = service.createQuery(
      { description: "CTF-2 legit" },
      {
        escrow: {
          type: "htlc",
          hash: entry.hash,
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "req_pub",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
        bounty: { amount_sats: 100 },
      },
    );
    service.recordOffer(query.id, {
      worker_pubkey: "02worker_hex_pubkey",
      offer_event_id: "e1",
      received_at: Date.now(),
    });

    const workerLockedToken = makeHtlcToken(
      100,
      entry.hash,
      "02worker_hex_pubkey",
    );

    const result = await service.selectWorker(
      query.id,
      "02worker_hex_pubkey",
      workerLockedToken,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Worker selected");
  });

  test("BLOCKED: token with wrong hashlock is rejected", async () => {
    const { service, preimageStore } = makeExploitService();
    const entry = preimageStore.create();

    const query = service.createQuery(
      { description: "CTF-2 wrong hash" },
      {
        escrow: {
          type: "htlc",
          hash: entry.hash,
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "req_pub",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
        bounty: { amount_sats: 100 },
      },
    );
    service.recordOffer(query.id, {
      worker_pubkey: "02worker_hex_pubkey",
      offer_event_id: "e1",
      received_at: Date.now(),
    });

    const wrongHashToken = makeHtlcToken(
      100,
      "deadbeef_wrong_hash",
      "02worker_hex_pubkey",
    );

    const result = await service.selectWorker(
      query.id,
      "02worker_hex_pubkey",
      wrongHashToken,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("HTLC hash mismatch");
  });

  test("ALLOWED: plain (non-HTLC) token passes through verifyLock", async () => {
    const { service, preimageStore } = makeExploitService();
    const entry = preimageStore.create();

    const query = service.createQuery(
      { description: "CTF-2 plain token" },
      {
        escrow: {
          type: "htlc",
          hash: entry.hash,
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "req_pub",
          locktime: Math.floor(Date.now() / 1000) + 3600,
        },
        bounty: { amount_sats: 100 },
      },
    );
    service.recordOffer(query.id, {
      worker_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });

    // Plain token (no HTLC secret) — Phase 1 hold tokens are plain and must pass verifyLock
    const plainToken = makeFakeToken(100);
    const result = await service.selectWorker(query.id, "w1", plainToken);
    expect(result.ok).toBe(true);
  });
});

describe("CTF-3: Minimum locktime enforcement", () => {
  test("BLOCKED: locktime 1 second in future is rejected", () => {
    const { service } = makeExploitService();
    const now = Math.floor(Date.now() / 1000);

    expect(() =>
      service.createQuery(
        { description: "CTF-3 exploit" },
        {
          escrow: {
            type: "htlc",
            hash: "somehash",
            oracle_pubkeys: ["oracle_pub"],
            requester_pubkey: "req_pub",
            locktime: now + 1, // Only 1 second!
          },
        },
      )
    ).toThrow(`escrow locktime must be at least ${MIN_ESCROW_LOCKTIME_SECS}s`);
  });

  test("BLOCKED: locktime in the past is rejected", () => {
    const { service } = makeExploitService();
    const now = Math.floor(Date.now() / 1000);

    expect(() =>
      service.createQuery(
        { description: "CTF-3 past locktime" },
        {
          escrow: {
            type: "htlc",
            hash: "somehash",
            oracle_pubkeys: ["oracle_pub"],
            requester_pubkey: "req_pub",
            locktime: now - 100, // In the past
          },
        },
      )
    ).toThrow(`escrow locktime must be at least ${MIN_ESCROW_LOCKTIME_SECS}s`);
  });

  test("BLOCKED: locktime exactly at minimum boundary is rejected", () => {
    const { service } = makeExploitService();
    const now = Math.floor(Date.now() / 1000);

    // Exactly MIN_ESCROW_LOCKTIME_SECS - 1 should fail
    expect(() =>
      service.createQuery(
        { description: "CTF-3 boundary" },
        {
          escrow: {
            type: "htlc",
            hash: "somehash",
            oracle_pubkeys: ["oracle_pub"],
            requester_pubkey: "req_pub",
            locktime: now + MIN_ESCROW_LOCKTIME_SECS - 1,
          },
        },
      )
    ).toThrow(`escrow locktime must be at least ${MIN_ESCROW_LOCKTIME_SECS}s`);
  });

  test("ALLOWED: locktime at exactly minimum passes", () => {
    const { service } = makeExploitService();
    const now = Math.floor(Date.now() / 1000);

    const query = service.createQuery(
      { description: "CTF-3 valid" },
      {
        escrow: {
          type: "htlc",
          hash: "somehash",
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "req_pub",
          locktime: now + MIN_ESCROW_LOCKTIME_SECS + 1, // Safely above minimum
        },
      },
    );
    expect(query.status).toBe("awaiting_offers");
  });

  test("ALLOWED: 1 hour locktime passes", () => {
    const { service } = makeExploitService();
    const now = Math.floor(Date.now() / 1000);

    const query = service.createQuery(
      { description: "CTF-3 normal locktime" },
      {
        escrow: {
          type: "htlc",
          hash: "somehash",
          oracle_pubkeys: ["oracle_pub"],
          requester_pubkey: "req_pub",
          locktime: now + 3600,
        },
      },
    );
    expect(query.escrow?.locktime).toBe(now + 3600);
  });

  test("ALLOWED: non-HTLC query has no locktime restriction", () => {
    const { service } = makeExploitService();

    const query = service.createQuery(
      { description: "No HTLC, no locktime" },
    );
    expect(query.status).toBe("pending");
  });
});
