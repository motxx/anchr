import { afterEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createOracleNostrService,
  _setPublishEventForTest,
  _setVerifyForTest,
} from "./oracle-nostr-service";
import type { OracleNostrServiceConfig } from "./oracle-nostr-service";
import { generateEphemeralIdentity } from "../nostr/identity";
import { createPreimageStore } from "../preimage/preimage-store";
import { createFrostCoordinator } from "../frost/coordinator";
import type { ThresholdOracleConfig } from "../../domain/oracle-types";
import type { FrostNodeConfig } from "../frost/config.ts";
import type { AttachmentRef } from "../../domain/types";
import type { VerifiedEvent } from "nostr-tools";

// --- Helpers ---

const workerIdentity = generateEphemeralIdentity();
const workerPubkey = workerIdentity.publicKey;

const frostConfig: ThresholdOracleConfig = {
  threshold: 2,
  total_signers: 3,
  signer_pubkeys: ["pub1", "pub2", "pub3"],
  group_pubkey: "aabb".repeat(16),
};

/** Minimal FrostNodeConfig for tests (no real key material). */
const frostNodeConfig: FrostNodeConfig = {
  signer_index: 1,
  total_signers: 3,
  threshold: 2,
  key_package: {},
  pubkey_package: {},
  group_pubkey: "aabb".repeat(16),
  peers: [
    { signer_index: 1, endpoint: "http://localhost:14301", api_key: "test" },
    { signer_index: 2, endpoint: "http://localhost:14302", api_key: "test" },
    { signer_index: 3, endpoint: "http://localhost:14303", api_key: "test" },
  ],
};

function makeConfig(
  overrides?: Partial<OracleNostrServiceConfig>,
): OracleNostrServiceConfig {
  return {
    identity: generateEphemeralIdentity(),
    preimageStore: createPreimageStore(),
    relayUrls: [],
    ...overrides,
  };
}

function makeQuery(id: string) {
  return {
    id,
    status: "verifying" as const,
    description: "test",
    verification_requirements: ["ai_check"] as const,
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
    payment_status: "htlc_swapped" as const,
  };
}

const makeResult = () => ({ attachments: [] as AttachmentRef[] });

// --- verifyAndDeliverFrost ---

describe("verifyAndDeliverFrost", () => {
  afterEach(() => {
    _setPublishEventForTest(null);
    _setVerifyForTest(null);
  });

  test("falls back to HTLC when frostNodeConfig not set", async () => {
    const store = createPreimageStore();
    const config = makeConfig({ preimageStore: store });
    const service = createOracleNostrService(config);
    service.generateHash("q1");

    const published: VerifiedEvent[] = [];
    _setPublishEventForTest(async (event: VerifiedEvent) => {
      published.push(event);
      return { successes: ["relay1"], failures: [] };
    });
    _setVerifyForTest(async () => ({
      passed: true,
      checks: ["all good"],
      failures: [],
    }));

    const passed = await service.verifyAndDeliverFrost("q1", makeQuery("q1"), makeResult(), workerPubkey);
    expect(passed).toBe(true);
    expect(published.length).toBe(1); // Preimage DM (HTLC fallback)
  });

  test("sends rejection DM on verification failure", async () => {
    const config = makeConfig({
      frostCoordinator: createFrostCoordinator(),
      frostConfig,
      frostNodeConfig,
    });
    const service = createOracleNostrService(config);

    const published: VerifiedEvent[] = [];
    _setPublishEventForTest(async (event: VerifiedEvent) => {
      published.push(event);
      return { successes: ["relay1"], failures: [] };
    });
    _setVerifyForTest(async () => ({
      passed: false,
      checks: [],
      failures: ["C2PA invalid"],
    }));

    const passed = await service.verifyAndDeliverFrost("q-rej", makeQuery("q-rej"), makeResult(), workerPubkey);
    expect(passed).toBe(false);
    expect(published.length).toBe(1); // Rejection DM
  });

  test("sends rejection when FROST signing fails (threshold not met)", async () => {
    const config = makeConfig({
      frostCoordinator: createFrostCoordinator(),
      frostConfig,
      frostNodeConfig,
    });
    const service = createOracleNostrService(config);

    const published: VerifiedEvent[] = [];
    _setPublishEventForTest(async (event: VerifiedEvent) => {
      published.push(event);
      return { successes: ["relay1"], failures: [] };
    });
    _setVerifyForTest(async () => ({
      passed: true,
      checks: ["all good"],
      failures: [],
    }));

    // Verification passes but coordinateSigning will fail (no real key material, no peers running)
    const passed = await service.verifyAndDeliverFrost("q-nopeer", makeQuery("q-nopeer"), makeResult(), workerPubkey);
    // Should return false because signing fails (peers unreachable, threshold not met)
    expect(passed).toBe(false);
    // Rejection DM about threshold not met
    expect(published.length).toBe(1);
  });
});
