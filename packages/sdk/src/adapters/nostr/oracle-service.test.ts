import { afterEach, beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { withEnv } from "../../testing/helpers.ts";
import {
  createOracleNostrService,
  createOracleNostrServiceFromEnv,
} from "./oracle-service.ts";
import type { OracleNostrServiceConfig } from "./oracle-service.ts";
import { generateEphemeralIdentity } from "../../identity.ts";
import { makeQuery } from "../../testing/factories.ts";
import { createPreimageStore } from "../../payments/mod.ts";
import type { Event } from "@anchr/protocol/nostr";
import type { PublishResult, RelayClient } from "../types.ts";

// --- Helpers ---

const providerIdentity = generateEphemeralIdentity();
const providerPubkey = providerIdentity.publicKey;

function makeCapturingRelay(
  result: () => PublishResult = () => ({
    successes: ["relay1"],
    failures: [],
  }),
): { client: RelayClient; published: Event[] } {
  const published: Event[] = [];
  const client: RelayClient = {
    publish(event: Event): Promise<PublishResult> {
      published.push(event);
      return Promise.resolve(result());
    },
    subscribe: () => ({ close: () => {} }),
    close: () => {},
  };
  return { client, published };
}

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

const verifyPass = () =>
  Promise.resolve({ passed: true, checks: ["all good"], failures: [] });
const verifyFail = () =>
  Promise.resolve({ passed: false, checks: [], failures: ["C2PA invalid"] });

// --- generateRequestHash ---

describe("generateRequestHash", () => {
  test("returns a hash string", () => {
    const config = makeConfig();
    const service = createOracleNostrService(config);
    const { hash } = service.generateRequestHash("q1");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  test("returns unique hash per query", () => {
    const config = makeConfig();
    const service = createOracleNostrService(config);
    const h1 = service.generateRequestHash("q1").hash;
    const h2 = service.generateRequestHash("q2").hash;
    expect(h1).not.toBe(h2);
  });

  test("stores preimage in preimage store", () => {
    const store = createPreimageStore();
    const service = createOracleNostrService(
      makeConfig({ preimageStore: store }),
    );
    const { hash } = service.generateRequestHash("q1");
    expect(store.has(hash)).toBe(true);
    expect(store.getPreimage(hash)).not.toBeNull();
  });
});

// --- verifyAndDeliver ---

describe("verifyAndDeliver", () => {
  test("publishes preimage DM on verification pass", async () => {
    const store = createPreimageStore();
    const relay = makeCapturingRelay();
    const published = relay.published;
    const config = makeConfig({
      preimageStore: store,
      relayClient: relay.client,
      verify: verifyPass,
    });
    const service = createOracleNostrService(config);
    const { hash } = service.generateRequestHash("q1");

    const query = {
      id: "q1",
      status: "processing" as const,
      description: "test",
      verification_requirements: ["gps" as const],
      created_at: Date.now(),
      expires_at: Date.now() + 600_000,
      payment_status: "escrow_swapped" as const,
    };

    const passed = await service.verifyAndDeliver("q1", query, {
      attachments: [],
    }, providerPubkey);
    expect(passed).toBe(true);
    expect(published.length).toBe(1);
    // Preimage should be deleted from store after delivery
    expect(store.has(hash)).toBe(false);
  });

  test("returns false and retains preimage when delivery fails", async () => {
    const store = createPreimageStore();
    const failingRelay = makeCapturingRelay(() => ({
      successes: [],
      failures: [{ relay: "relay1", reason: "down" }],
    }));
    const config = makeConfig({
      deliveryRetryDelaysMs: [0, 0],
      preimageStore: store,
      relayClient: failingRelay.client,
      verify: verifyPass,
    });
    const service = createOracleNostrService(config);
    const { hash } = service.generateRequestHash("q-delivery-fail");

    const query = {
      id: "q-delivery-fail",
      status: "processing" as const,
      description: "test",
      verification_requirements: ["gps" as const],
      created_at: Date.now(),
      expires_at: Date.now() + 600_000,
      payment_status: "escrow_swapped" as const,
    };

    const passed = await service.verifyAndDeliver(
      "q-delivery-fail",
      query,
      { attachments: [] },
      providerPubkey,
    );
    expect(passed).toBe(false);
    expect(store.has(hash)).toBe(true);
  });

  test("publishes rejection DM on verification fail", async () => {
    const store = createPreimageStore();
    const relay = makeCapturingRelay();
    const published = relay.published;
    const config = makeConfig({
      preimageStore: store,
      relayClient: relay.client,
      verify: verifyFail,
    });
    const service = createOracleNostrService(config);
    service.generateRequestHash("q1");

    const query = {
      id: "q1",
      status: "processing" as const,
      description: "test",
      verification_requirements: ["gps" as const],
      created_at: Date.now(),
      expires_at: Date.now() + 600_000,
      payment_status: "escrow_swapped" as const,
    };

    const passed = await service.verifyAndDeliver("q1", query, {
      attachments: [],
    }, providerPubkey);
    expect(passed).toBe(false);
    expect(published.length).toBe(1);
  });

  test("returns false when hash not registered", async () => {
    const config = makeConfig({ verify: verifyPass });
    const service = createOracleNostrService(config);
    // Do NOT call generateRequestHash

    const query = {
      id: "q_unknown",
      status: "processing" as const,
      description: "test",
      verification_requirements: ["gps" as const],
      created_at: Date.now(),
      expires_at: Date.now() + 600_000,
      payment_status: "escrow_swapped" as const,
    };

    // Verify passes but no preimage exists, so rejection DM is sent
    const passed = await service.verifyAndDeliver("q_unknown", query, {
      attachments: [],
    }, providerPubkey);
    expect(passed).toBe(false);
  });
});

// --- recordSelectedProvider ---

describe("recordSelectedProvider", () => {
  let service: ReturnType<typeof createOracleNostrService>;

  beforeEach(() => {
    service = createOracleNostrService(makeConfig());
  });

  afterEach(() => {
    service.stop();
  });

  test("records provider pubkey for watched query", () => {
    // watchRequest requires relay subscriptions — but with empty relayUrls it still records the entry
    service.watchRequest(makeQuery({ id: "q1" }), "evt1", "customer_pub");
    // Should not throw
    service.recordSelectedProvider("q1", providerPubkey);
  });

  test("no-op for unknown query", () => {
    // Should not throw even for non-watched query
    service.recordSelectedProvider("unknown", providerPubkey);
  });
});

// --- createOracleNostrServiceFromEnv ---

describe("createOracleNostrServiceFromEnv", () => {
  test("returns null when env var is not set", () => {
    withEnv({ ORACLE_NOSTR_SECRET_KEY: undefined }, () => {
      const service = createOracleNostrServiceFromEnv();
      expect(service).toBeNull();
    });
  });
});

// --- stop ---

describe("stop", () => {
  test("completes without error", () => {
    const config = makeConfig();
    const service = createOracleNostrService(config);
    // Should not throw
    service.stop();
  });

  test("completes without error after watching queries", () => {
    const config = makeConfig();
    const service = createOracleNostrService(config);
    service.watchRequest(makeQuery({ id: "q1" }), "evt1", "customer_pub");
    // Should not throw
    service.stop();
  });
});
