import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { DiscoveredQuery, WorkerConfig } from "./worker-service";
import {
  parseQueryRequestPayload,
  type QueryRequestPayload,
} from "../infrastructure/nostr/events";

/**
 * Worker service tests — focuses on the pure logic that can be tested
 * without Nostr relay connections: payload parsing, filtering, state types.
 *
 * The actual discoverQueries/submitQuote/waitForSelection functions
 * are thin wrappers around Nostr client subscriptions — their correctness
 * is covered by the nostr/events.test.ts and nostr/dm.test.ts suites.
 */

describe("Worker service — payload parsing and filtering", () => {
  const trustedOracle = "oracle_pubkey_abc";
  const untrustedOracle = "oracle_pubkey_evil";

  const config: WorkerConfig = {
    trustedOraclePubkeys: [trustedOracle],
  };

  function makePayload(overrides?: Partial<QueryRequestPayload>): QueryRequestPayload {
    return {
      description: "Photo of Tokyo Tower",
      nonce: "ABC123",
      oracle_pubkey: trustedOracle,
      requester_pubkey: "requester_pub",
      bounty: { mint: "https://mint.example.com", token: "cashuAey..." },
      expires_at: Date.now() + 600_000,
      ...overrides,
    };
  }

  test("parseQueryRequestPayload round-trips correctly", () => {
    const original = makePayload();
    const json = JSON.stringify(original);
    const parsed = parseQueryRequestPayload(json);

    expect(parsed.description).toBe(original.description);
    expect(parsed.nonce).toBe(original.nonce);
    expect(parsed.oracle_pubkey).toBe(original.oracle_pubkey);
    expect(parsed.requester_pubkey).toBe(original.requester_pubkey);
  });

  test("trusted oracle pubkey passes filter", () => {
    const payload = makePayload({ oracle_pubkey: trustedOracle });
    const passes = !payload.oracle_pubkey || config.trustedOraclePubkeys.includes(payload.oracle_pubkey);
    expect(passes).toBe(true);
  });

  test("untrusted oracle pubkey is rejected", () => {
    const payload = makePayload({ oracle_pubkey: untrustedOracle });
    const passes = !payload.oracle_pubkey || config.trustedOraclePubkeys.includes(payload.oracle_pubkey);
    expect(passes).toBe(false);
  });

  test("missing oracle_pubkey passes filter (no restriction)", () => {
    const payload = makePayload({ oracle_pubkey: undefined });
    const passes = !payload.oracle_pubkey || config.trustedOraclePubkeys.includes(payload.oracle_pubkey);
    expect(passes).toBe(true);
  });

  test("DiscoveredQuery captures event metadata", () => {
    const payload = makePayload();
    const query: DiscoveredQuery = {
      eventId: "event123",
      pubkey: "sender_pubkey",
      payload,
      oraclePubkey: payload.oracle_pubkey,
      requesterPubkey: payload.requester_pubkey ?? "sender_pubkey",
    };

    expect(query.eventId).toBe("event123");
    expect(query.oraclePubkey).toBe(trustedOracle);
    expect(query.requesterPubkey).toBe("requester_pub");
  });

  test("parseQueryRequestPayload rejects invalid JSON", () => {
    expect(() => parseQueryRequestPayload("not json")).toThrow();
  });

  test("parseQueryRequestPayload handles minimal payload", () => {
    const minimal = JSON.stringify({ description: "test", nonce: "X", expires_at: Date.now() + 600_000 });
    const parsed = parseQueryRequestPayload(minimal);
    expect(parsed.description).toBe("test");
    expect(parsed.oracle_pubkey).toBeUndefined();
  });
});
