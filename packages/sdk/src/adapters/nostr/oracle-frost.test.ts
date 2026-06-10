import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createOracleNostrService } from "./oracle-service.ts";
import type { OracleNostrServiceConfig } from "./oracle-service.ts";
import { generateEphemeralIdentity } from "../../identity.ts";
import { createPreimageStore } from "../../payments/mod.ts";
import { createFrostCoordinator } from "../../payments/mod.ts";
import type { ThresholdOracleConfig } from "../../payments/mod.ts";
import type { FrostNodeConfig } from "../../payments/mod.ts";
import type { AttachmentRef } from "../../requests/domain/types.ts";
import type { Event } from "@anchr/protocol/nostr";
import type { PublishResult, RelayClient } from "../types.ts";

function makeCapturingRelay(): { client: RelayClient; published: Event[] } {
  const published: Event[] = [];
  const client: RelayClient = {
    publish(event: Event): Promise<PublishResult> {
      published.push(event);
      return Promise.resolve({ successes: ["relay1"], failures: [] });
    },
    subscribe: () => ({ close: () => {} }),
    close: () => {},
  };
  return { client, published };
}

const verifyPass = () =>
  Promise.resolve({ passed: true, checks: ["all good"], failures: [] });
const verifyFail = () =>
  Promise.resolve({ passed: false, checks: [], failures: ["C2PA invalid"] });

// --- Helpers ---

const providerIdentity = generateEphemeralIdentity();
const providerPubkey = providerIdentity.publicKey;

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
    relayClient: makeCapturingRelay().client,
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
    payment_status: "escrow_swapped" as const,
  };
}

const makeResult = () => ({ attachments: [] as AttachmentRef[] });

// --- verifyAndDeliverWithFrost ---

describe("verifyAndDeliverWithFrost", () => {
  test("falls back to HTLC when frostNodeConfig not set", async () => {
    const store = createPreimageStore();
    const relay = makeCapturingRelay();
    const published = relay.published;
    const config = makeConfig({
      preimageStore: store,
      relayClient: relay.client,
      verify: verifyPass,
    });
    const service = createOracleNostrService(config);
    service.generateRequestHash("q1");

    const passed = await service.verifyAndDeliverWithFrost(
      "q1",
      makeQuery("q1"),
      makeResult(),
      providerPubkey,
    );
    expect(passed).toBe(true);
    expect(published.length).toBe(1); // Preimage DM (HTLC fallback)
  });

  test("sends rejection DM on verification failure", async () => {
    const relay = makeCapturingRelay();
    const published = relay.published;
    const config = makeConfig({
      frostCoordinator: createFrostCoordinator(),
      frostConfig,
      frostNodeConfig,
      relayClient: relay.client,
      verify: verifyFail,
    });
    const service = createOracleNostrService(config);

    const passed = await service.verifyAndDeliverWithFrost(
      "q-rej",
      makeQuery("q-rej"),
      makeResult(),
      providerPubkey,
    );
    expect(passed).toBe(false);
    expect(published.length).toBe(1); // Rejection DM
  });

  test("sends rejection when FROST signing fails (threshold not met)", async () => {
    const relay = makeCapturingRelay();
    const published = relay.published;
    const config = makeConfig({
      frostCoordinator: createFrostCoordinator(),
      frostConfig,
      frostNodeConfig,
      relayClient: relay.client,
      verify: verifyPass,
    });
    const service = createOracleNostrService(config);

    // Verification passes but coordinateSigning will fail (no real key material, no peers running)
    const passed = await service.verifyAndDeliverWithFrost(
      "q-nopeer",
      makeQuery("q-nopeer"),
      makeResult(),
      providerPubkey,
    );
    // Should return false because signing fails (peers unreachable, threshold not met)
    expect(passed).toBe(false);
    // Rejection DM about threshold not met
    expect(published.length).toBe(1);
  });
});
