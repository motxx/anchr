import { describe, test, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getNostrConfig, isNostrEnabled, closePool } from "./client";

/**
 * Nostr client tests — focuses on configuration parsing and guard behavior.
 *
 * Actual relay connectivity requires a running Nostr relay.
 * These tests verify the config layer and enable/disable logic.
 */

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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

describe("closePool", () => {
  test("does not throw when no pool exists", () => {
    // Should be safe to call multiple times
    expect(() => closePool()).not.toThrow();
    expect(() => closePool()).not.toThrow();
  });
});
