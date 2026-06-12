import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createFrostCoordinator,
  FROST_FINALIZED_RETENTION_MS,
  FROST_SESSION_TTL_MS,
} from "./frost-coordinator.ts";
import type { ThresholdOracleConfig } from "./frost-types.ts";

const config: ThresholdOracleConfig = {
  threshold: 2,
  total_signers: 3,
  signer_pubkeys: ["pub1", "pub2", "pub3"],
  group_pubkey: "aabb".repeat(16),
};

describe("frost coordinator session eviction", () => {
  test("abandoned signing sessions are evicted after the TTL", () => {
    let t = 0;
    const coordinator = createFrostCoordinator({ now: () => t });
    const stale = coordinator.startSigning("q-stale", "msg", config);

    t = FROST_SESSION_TTL_MS + 1;
    coordinator.startSigning("q-fresh", "msg", config);

    expect(coordinator.getSigningSession(stale.session_id)).toBeUndefined();
  });

  test("abandoned DKG sessions are evicted after the TTL", () => {
    let t = 0;
    const coordinator = createFrostCoordinator({ now: () => t });
    const stale = coordinator.initDkg({ threshold: 2, total: 3 });

    t = FROST_SESSION_TTL_MS + 1;
    coordinator.initDkg({ threshold: 2, total: 3 });

    expect(coordinator.getDkgSession(stale.session_id)).toBeUndefined();
  });

  test("finalized signing sessions are dropped after the retention window", () => {
    let t = 0;
    const coordinator = createFrostCoordinator({ now: () => t });
    const session = coordinator.startSigning("q-final", "msg", config);
    session.finalized = true;

    t = FROST_FINALIZED_RETENTION_MS + 1;
    coordinator.startSigning("q-next", "msg", config);

    expect(coordinator.getSigningSession(session.session_id)).toBeUndefined();
  });

  test("active sessions within the TTL are retained", () => {
    let t = 0;
    const coordinator = createFrostCoordinator({ now: () => t });
    const session = coordinator.startSigning("q-active", "msg", config);

    t = FROST_SESSION_TTL_MS - 1;
    coordinator.startSigning("q-other", "msg", config);

    expect(coordinator.getSigningSession(session.session_id)).toBeDefined();
  });
});
