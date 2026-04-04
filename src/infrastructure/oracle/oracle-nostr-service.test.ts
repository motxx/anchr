import { afterEach, beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { withEnv } from "../../testing/helpers";
import {
  createOracleNostrService,
  createOracleNostrServiceFromEnv,
  _setPublishEventForTest,
  _setVerifyForTest,
} from "./oracle-nostr-service";
import type { OracleNostrServiceConfig } from "./oracle-nostr-service";
import { generateEphemeralIdentity } from "../nostr/identity";
import { createPreimageStore } from "../cashu/preimage-store";
import type { VerifiedEvent } from "nostr-tools";

// --- Helpers ---

const workerIdentity = generateEphemeralIdentity();
const workerPubkey = workerIdentity.publicKey;

function makeConfig(overrides?: Partial<OracleNostrServiceConfig>): OracleNostrServiceConfig {
  return {
    identity: generateEphemeralIdentity(),
    preimageStore: createPreimageStore(),
    relayUrls: [],
    ...overrides,
  };
}


// --- Teardown ---

afterEach(() => {
  _setPublishEventForTest(null);
  _setVerifyForTest(null);
});

// --- generateHash ---

describe("generateHash", () => {
  test("returns a hash string", () => {
    const config = makeConfig();
    const service = createOracleNostrService(config);
    const { hash } = service.generateHash("q1");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  test("returns unique hash per query", () => {
    const config = makeConfig();
    const service = createOracleNostrService(config);
    const h1 = service.generateHash("q1").hash;
    const h2 = service.generateHash("q2").hash;
    expect(h1).not.toBe(h2);
  });

  test("stores preimage in preimage store", () => {
    const store = createPreimageStore();
    const service = createOracleNostrService(makeConfig({ preimageStore: store }));
    const { hash } = service.generateHash("q1");
    expect(store.has(hash)).toBe(true);
    expect(store.getPreimage(hash)).not.toBeNull();
  });
});

// --- verifyAndDeliver ---

describe("verifyAndDeliver", () => {
  test("publishes preimage DM on verification pass", async () => {
    const store = createPreimageStore();
    const config = makeConfig({ preimageStore: store });
    const service = createOracleNostrService(config);
    const { hash } = service.generateHash("q1");

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

    const query = {
      id: "q1",
      status: "processing" as const,
      description: "test",
      verification_requirements: ["gps" as const],
      created_at: Date.now(),
      expires_at: Date.now() + 600_000,
      payment_status: "htlc_swapped" as const,
    };

    const passed = await service.verifyAndDeliver("q1", query, { attachments: [] }, workerPubkey);
    expect(passed).toBe(true);
    expect(published.length).toBe(1);
    // Preimage should be deleted from store after delivery
    expect(store.has(hash)).toBe(false);
  });

  test("publishes rejection DM on verification fail", async () => {
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
      passed: false,
      checks: [],
      failures: ["C2PA invalid"],
    }));

    const query = {
      id: "q1",
      status: "processing" as const,
      description: "test",
      verification_requirements: ["gps" as const],
      created_at: Date.now(),
      expires_at: Date.now() + 600_000,
      payment_status: "htlc_swapped" as const,
    };

    const passed = await service.verifyAndDeliver("q1", query, { attachments: [] }, workerPubkey);
    expect(passed).toBe(false);
    expect(published.length).toBe(1);
  });

  test("returns false when hash not registered", async () => {
    const config = makeConfig();
    const service = createOracleNostrService(config);
    // Do NOT call generateHash

    _setPublishEventForTest(async () => ({ successes: [], failures: [] }));
    _setVerifyForTest(async () => ({
      passed: true,
      checks: ["all good"],
      failures: [],
    }));

    const query = {
      id: "q_unknown",
      status: "processing" as const,
      description: "test",
      verification_requirements: ["gps" as const],
      created_at: Date.now(),
      expires_at: Date.now() + 600_000,
      payment_status: "htlc_swapped" as const,
    };

    // Verify passes but no preimage exists, so rejection DM is sent
    const passed = await service.verifyAndDeliver("q_unknown", query, { attachments: [] }, workerPubkey);
    expect(passed).toBe(false);
  });
});

// --- recordSelectedWorker ---

describe("recordSelectedWorker", () => {
  let service: ReturnType<typeof createOracleNostrService>;

  beforeEach(() => {
    service = createOracleNostrService(makeConfig());
  });

  afterEach(() => {
    service.stop();
  });

  test("records worker pubkey for watched query", () => {
    // watchQuery requires relay subscriptions — but with empty relayUrls it still records the entry
    service.watchQuery("q1", "evt1", "requester_pub");
    // Should not throw
    service.recordSelectedWorker("q1", workerPubkey);
  });

  test("no-op for unknown query", () => {
    // Should not throw even for non-watched query
    service.recordSelectedWorker("unknown", workerPubkey);
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
    service.watchQuery("q1", "evt1", "requester_pub");
    // Should not throw
    service.stop();
  });
});
