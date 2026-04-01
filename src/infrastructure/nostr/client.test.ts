import { describe, test, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getNostrConfig, isNostrEnabled, closePool, publishEvent } from "./client";
import { generateEphemeralIdentity } from "./identity";
import { buildQueryRequestEvent } from "./events";

function withEnv(overrides: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const result = fn();
  if (result instanceof Promise) return result.finally(restore);
  restore();
}

afterEach(() => {
  closePool();
});

describe("getNostrConfig", () => {
  test("returns null when NOSTR_RELAYS is not set", () => {
    withEnv({ NOSTR_RELAYS: undefined }, () => {
      expect(getNostrConfig()).toBeNull();
    });
  });

  test("returns null when NOSTR_RELAYS is empty", () => {
    withEnv({ NOSTR_RELAYS: "" }, () => {
      expect(getNostrConfig()).toBeNull();
    });
  });

  test("returns null when NOSTR_RELAYS is only whitespace/commas", () => {
    withEnv({ NOSTR_RELAYS: " , , " }, () => {
      expect(getNostrConfig()).toBeNull();
    });
  });

  test("parses single relay URL", () => {
    withEnv({ NOSTR_RELAYS: "ws://localhost:7777" }, () => {
      const config = getNostrConfig();
      expect(config).not.toBeNull();
      expect(config!.relayUrls).toEqual(["ws://localhost:7777"]);
    });
  });

  test("parses multiple relay URLs", () => {
    withEnv({ NOSTR_RELAYS: "ws://relay1.example.com,wss://relay2.example.com" }, () => {
      const config = getNostrConfig();
      expect(config).not.toBeNull();
      expect(config!.relayUrls).toEqual([
        "ws://relay1.example.com",
        "wss://relay2.example.com",
      ]);
    });
  });

  test("trims whitespace from relay URLs", () => {
    withEnv({ NOSTR_RELAYS: " ws://relay1.example.com , wss://relay2.example.com " }, () => {
      const config = getNostrConfig();
      expect(config!.relayUrls).toEqual([
        "ws://relay1.example.com",
        "wss://relay2.example.com",
      ]);
    });
  });

  test("filters empty entries after split", () => {
    withEnv({ NOSTR_RELAYS: "ws://relay1,,ws://relay2," }, () => {
      const config = getNostrConfig();
      expect(config!.relayUrls).toEqual(["ws://relay1", "ws://relay2"]);
    });
  });
});

describe("isNostrEnabled", () => {
  test("returns false when relays not configured", () => {
    withEnv({ NOSTR_RELAYS: undefined }, () => {
      expect(isNostrEnabled()).toBe(false);
    });
  });

  test("returns true when relays are configured", () => {
    withEnv({ NOSTR_RELAYS: "ws://localhost:7777" }, () => {
      expect(isNostrEnabled()).toBe(true);
    });
  });
});

describe("publishEvent", () => {
  test("returns empty successes and 'No relays configured' failure when no relays", async () => {
    await withEnv({ NOSTR_RELAYS: undefined }, async () => {
      const identity = generateEphemeralIdentity();
      const event = buildQueryRequestEvent(identity, "q1", {
        description: "test",
        nonce: "X",
      });
      const result = await publishEvent(event);
      expect(result.successes).toEqual([]);
      expect(result.failures).toEqual(["No relays configured"]);
    });
  });

  test("handles relay URLs without throwing", async () => {
    const identity = generateEphemeralIdentity();
    const event = buildQueryRequestEvent(identity, "q1", {
      description: "test",
      nonce: "X",
    });
    // publishEvent should not throw even with bad relay URLs
    const result = await publishEvent(event, ["ws://localhost:1"]);
    // nostr-tools pool.publish resolves per relay; result varies by connectivity
    expect(result.successes.length + result.failures.length).toBe(1);
  });
});

describe("closePool", () => {
  test("does not throw when no pool exists", () => {
    expect(() => closePool()).not.toThrow();
    expect(() => closePool()).not.toThrow();
  });
});
