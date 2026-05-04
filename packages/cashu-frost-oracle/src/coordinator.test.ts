import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createFrostCoordinator } from "./coordinator.ts";
import type { ThresholdOracleConfig } from "./types.ts";

function makeConfig(overrides?: Partial<ThresholdOracleConfig>): ThresholdOracleConfig {
  return {
    threshold: 2,
    total_signers: 3,
    signer_pubkeys: ["aaa", "bbb", "ccc"],
    group_pubkey: "group_pub_" + "ab".repeat(16),
    ...overrides,
  };
}

describe("FrostCoordinator", () => {
  // --- DKG ---

  test("initDkg creates a session with correct config", () => {
    const coord = createFrostCoordinator();
    const session = coord.initDkg({ threshold: 2, total: 3 });

    expect(session.threshold).toBe(2);
    expect(session.total_signers).toBe(3);
    expect(session.current_round).toBe(0);
    expect(session.session_id).toMatch(/^frost_/);
    expect(session.round1_packages.size).toBe(0);
  });

  test("initDkg generates unique session IDs", () => {
    const coord = createFrostCoordinator();
    const s1 = coord.initDkg({ threshold: 2, total: 3 });
    const s2 = coord.initDkg({ threshold: 2, total: 3 });
    expect(s1.session_id).not.toBe(s2.session_id);
  });

  test("submitDkgPackage round 1 returns complete:true when all signers submit", async () => {
    const coord = createFrostCoordinator();
    const session = coord.initDkg({ threshold: 2, total: 3 });

    await coord.submitDkgPackage(session.session_id, 1, 0, '{"pkg":"r1_0"}', '{"secret":"s0"}');
    await coord.submitDkgPackage(session.session_id, 1, 1, '{"pkg":"r1_1"}', '{"secret":"s1"}');
    const result = await coord.submitDkgPackage(session.session_id, 1, 2, '{"pkg":"r1_2"}', '{"secret":"s2"}');

    expect(result).not.toBeNull();
    expect(result!.round).toBe(1);
    expect(result!.complete).toBe(true);
  });

  test("submitDkgPackage round 1 returns complete:false when not all signers submitted", async () => {
    const coord = createFrostCoordinator();
    const session = coord.initDkg({ threshold: 2, total: 3 });

    const result = await coord.submitDkgPackage(session.session_id, 1, 0, '{"pkg":"r1_0"}');

    expect(result).not.toBeNull();
    expect(result!.round).toBe(1);
    expect(result!.complete).toBe(false);
  });

  test("submitDkgPackage returns null for unknown session", async () => {
    const coord = createFrostCoordinator();
    const result = await coord.submitDkgPackage("nonexistent_session", 1, 0, '{"pkg":"test"}');
    expect(result).toBeNull();
  });

  test("getDkgSession returns undefined for unknown session", () => {
    const coord = createFrostCoordinator();
    expect(coord.getDkgSession("nonexistent")).toBeUndefined();
  });

  // --- Signing ---

  test("startSigning creates session with correct config", () => {
    const coord = createFrostCoordinator();
    const config = makeConfig();
    const session = coord.startSigning("query_42", "deadbeef", config);

    expect(session.session_id).toMatch(/^frost_/);
    expect(session.query_id).toBe("query_42");
    expect(session.message).toBe("deadbeef");
    expect(session.config).toBe(config);
    expect(session.finalized).toBe(false);
    expect(session.nonce_commitments.size).toBe(0);
    expect(session.signature_shares.size).toBe(0);
  });

  test("submitNonceCommitment stores commitment", () => {
    const coord = createFrostCoordinator();
    const config = makeConfig();
    const session = coord.startSigning("q1", "msg", config);

    coord.submitNonceCommitment(session.session_id, "aaa", "commitment_aaa");
    coord.submitNonceCommitment(session.session_id, "bbb", "commitment_bbb");

    const retrieved = coord.getSigningSession(session.session_id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.nonce_commitments.get("aaa")).toBe("commitment_aaa");
    expect(retrieved!.nonce_commitments.get("bbb")).toBe("commitment_bbb");
  });

  test("submitSignatureShare stores share", () => {
    const coord = createFrostCoordinator();
    const config = makeConfig();
    const session = coord.startSigning("q2", "msg", config);

    coord.submitSignatureShare(session.session_id, "aaa", "share_aaa");

    const retrieved = coord.getSigningSession(session.session_id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.signature_shares.get("aaa")).toBe("share_aaa");
  });

  test("submitNonceCommitment is ignored on finalized session", () => {
    const coord = createFrostCoordinator();
    const config = makeConfig();
    const session = coord.startSigning("q3", "msg", config);

    // Manually finalize the session by modifying it
    const retrieved = coord.getSigningSession(session.session_id)!;
    retrieved.finalized = true;

    coord.submitNonceCommitment(session.session_id, "aaa", "commitment_late");

    expect(retrieved.nonce_commitments.size).toBe(0);
  });

  test("getSigningSession returns session state", () => {
    const coord = createFrostCoordinator();
    const config = makeConfig();
    const session = coord.startSigning("q4", "msg", config);

    const retrieved = coord.getSigningSession(session.session_id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.session_id).toBe(session.session_id);
    expect(retrieved!.query_id).toBe("q4");
  });

  test("tryAggregate returns null when below threshold", async () => {
    const coord = createFrostCoordinator();
    const config = makeConfig({ threshold: 2 });
    const session = coord.startSigning("q5", "msg", config);

    // Submit only 1 share (below threshold of 2)
    coord.submitSignatureShare(session.session_id, "aaa", "share_aaa");

    const result = await coord.tryAggregate(session.session_id);
    expect(result).toBeNull();
  });
});
