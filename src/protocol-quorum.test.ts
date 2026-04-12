/**
 * Protocol-level tests for quorum (t-of-n) independent Oracle verification.
 *
 * Tests the security properties of the threshold Oracle model where only
 * neutral, independent Oracle operators are verifiers. Requester and Worker
 * are NOT signers — they are transaction parties only.
 *
 * Test categories:
 *   1. Quorum threshold enforcement — min_approvals respected
 *   2. Single malicious Oracle — cannot approve alone
 *   3. Majority honest — garbage rejected despite minority collusion
 *   4. Oracle availability — degrades gracefully
 *   5. Backward compat — single Oracle (no quorum) still works
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { Query, QueryResult } from "./domain/types";
import {
  makeMockOracle,
  makeQuorumService,
  driveQuorumToProcessing,
  driveToProcessing,
  makeServiceWithPreimage,
} from "./testing/protocol-helpers";

// =============================================================================
// 1. Quorum threshold enforcement
// =============================================================================

describe("Quorum: threshold enforcement", () => {
  test("2-of-3: all 3 approve → passes, preimage revealed", async () => {
    const ids = ["anchr", "oracle-a", "oracle-b"];
    const { service, preimageStore } = makeQuorumService({ oracleIds: ids });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 2);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBeDefined();
  });

  test("2-of-3: 2 approve, 1 rejects → still passes (threshold met)", async () => {
    const ids = ["anchr", "oracle-a", "oracle-b"];
    const { service, preimageStore } = makeQuorumService({
      oracleIds: ids,
      passFns: { "oracle-b": () => false },  // oracle-b rejects
    });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 2);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBeDefined();
  });

  test("2-of-3: only 1 approves, 2 reject → fails (below threshold)", async () => {
    const ids = ["anchr", "oracle-a", "oracle-b"];
    const { service, preimageStore } = makeQuorumService({
      oracleIds: ids,
      passFns: {
        "oracle-a": () => false,
        "oracle-b": () => false,
      },
    });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 2);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
  });

  test("3-of-5: exactly 3 approve → passes", async () => {
    const ids = ["anchr", "oracle-a", "oracle-b", "oracle-c", "oracle-d"];
    const { service, preimageStore } = makeQuorumService({
      oracleIds: ids,
      passFns: {
        "oracle-c": () => false,
        "oracle-d": () => false,
      },
    });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 3);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(true);
  });

  test("3-of-5: only 2 approve → fails", async () => {
    const ids = ["anchr", "oracle-a", "oracle-b", "oracle-c", "oracle-d"];
    const { service, preimageStore } = makeQuorumService({
      oracleIds: ids,
      passFns: {
        "oracle-b": () => false,
        "oracle-c": () => false,
        "oracle-d": () => false,
      },
    });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 3);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(false);
  });
});

// =============================================================================
// 2. Single malicious Oracle — cannot approve alone
// =============================================================================

describe("Quorum: single malicious Oracle cannot decide alone", () => {
  test("Anchr approves garbage, others reject → rejected", async () => {
    const ids = ["anchr", "oracle-a", "oracle-b"];
    const { service, preimageStore } = makeQuorumService({
      oracleIds: ids,
      passFns: {
        "anchr": () => true,     // malicious: approves garbage
        "oracle-a": () => false,  // honest: rejects
        "oracle-b": () => false,  // honest: rejects
      },
    });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 2);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.preimage).toBeUndefined();
  });

  test("Anchr rejects valid work, others approve → approved", async () => {
    const ids = ["anchr", "oracle-a", "oracle-b"];
    const { service, preimageStore } = makeQuorumService({
      oracleIds: ids,
      passFns: {
        "anchr": () => false,    // malicious: rejects valid work
        "oracle-a": () => true,   // honest: approves
        "oracle-b": () => true,   // honest: approves
      },
    });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 2);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBeDefined();
  });
});

// =============================================================================
// 3. Collusion resistance
// =============================================================================

describe("Quorum: collusion resistance", () => {
  test("2-of-3: Anchr + one colluder approve garbage → passes (threshold met)", async () => {
    // This is the security boundary — 2 colluding Oracles CAN approve.
    // The defense is that each Oracle is independently operated.
    const ids = ["anchr", "oracle-a", "oracle-b"];
    const { service, preimageStore } = makeQuorumService({
      oracleIds: ids,
      passFns: {
        "anchr": () => true,     // colluder
        "oracle-a": () => true,   // colluder
        "oracle-b": () => false,  // honest
      },
    });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 2);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    // 2 colluders meet threshold — this is expected.
    // Security depends on independent Oracle operation, not protocol alone.
    expect(outcome.ok).toBe(true);
  });

  test("3-of-5: 2 colluders still blocked (need 3)", async () => {
    const ids = ["anchr", "oracle-a", "oracle-b", "oracle-c", "oracle-d"];
    const { service, preimageStore } = makeQuorumService({
      oracleIds: ids,
      passFns: {
        "anchr": () => true,     // colluder
        "oracle-a": () => true,   // colluder
        "oracle-b": () => false,
        "oracle-c": () => false,
        "oracle-d": () => false,
      },
    });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 3);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(false);
  });
});

// =============================================================================
// 4. Oracle availability
// =============================================================================

describe("Quorum: Oracle availability", () => {
  test("2-of-3 with only 2 Oracles registered → passes if both approve", async () => {
    // One Oracle is unavailable (not registered).
    const ids = ["anchr", "oracle-a"];
    const { service, preimageStore } = makeQuorumService({ oracleIds: ids });
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 2);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(true);
  });

  test("2-of-3 with only 1 Oracle registered → fails (insufficient)", async () => {
    const ids = ["anchr"];
    const { service, preimageStore } = makeQuorumService({ oracleIds: ids });
    const { query } = await driveQuorumToProcessing(
      service, preimageStore,
      ["anchr", "oracle-a", "oracle-b"],  // query expects 3, but only 1 registered
      2,
    );

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(false);
  });
});

// =============================================================================
// 5. Backward compat — single Oracle (no quorum)
// =============================================================================

describe("Quorum: backward compat — no quorum = single Oracle", () => {
  test("no quorum config → single Oracle, preimage revealed on pass", async () => {
    const { service, preimageStore } = makeServiceWithPreimage();
    const { query } = await driveToProcessing(service, preimageStore);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.preimage).toBeDefined();
  });

  test("quorum config added later → multi-Oracle verification applies", async () => {
    const ids = ["anchr", "oracle-a", "oracle-b"];
    const { service, preimageStore } = makeQuorumService({
      oracleIds: ids,
      passFns: { "oracle-b": () => false },
    });

    // Drive with quorum
    const { query } = await driveQuorumToProcessing(service, preimageStore, ids, 2);

    const outcome = await service.submitHtlcResult(
      query.id, { attachments: [] }, "worker_pub",
    );
    // 2-of-3 pass (anchr + oracle-a) → approved
    expect(outcome.ok).toBe(true);

    // Query should have attestations from multiple oracles
    const updated = service.getQuery(query.id);
    expect(updated?.attestations).toBeDefined();
    expect(updated!.attestations!.length).toBeGreaterThanOrEqual(2);
  });
});
