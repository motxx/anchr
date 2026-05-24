import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type {
  DiscoveredRequest,
  ProviderNostrConfig,
} from "./worker-service.ts";
import {
  parseQueryRequestPayload,
  type QueryRequestPayload,
} from "./events/events.ts";

describe("Provider service — payload parsing and filtering", () => {
  const trustedOracle = "oracle_pubkey_abc";
  const untrustedOracle = "oracle_pubkey_evil";

  const config: ProviderNostrConfig = {
    trustedOraclePubkeys: [trustedOracle],
  };

  function makePayload(
    overrides?: Partial<QueryRequestPayload>,
  ): QueryRequestPayload {
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
    const passes = !payload.oracle_pubkey ||
      config.trustedOraclePubkeys.includes(payload.oracle_pubkey);
    expect(passes).toBe(true);
  });

  test("untrusted oracle pubkey is rejected", () => {
    const payload = makePayload({ oracle_pubkey: untrustedOracle });
    const passes = !payload.oracle_pubkey ||
      config.trustedOraclePubkeys.includes(payload.oracle_pubkey);
    expect(passes).toBe(false);
  });

  test("missing oracle_pubkey passes filter (no restriction)", () => {
    const payload = makePayload({ oracle_pubkey: undefined });
    const passes = !payload.oracle_pubkey ||
      config.trustedOraclePubkeys.includes(payload.oracle_pubkey);
    expect(passes).toBe(true);
  });

  test("DiscoveredRequest captures event metadata", () => {
    const payload = makePayload();
    const request: DiscoveredRequest = {
      eventId: "event123",
      pubkey: "sender_pubkey",
      payload,
      oraclePubkey: payload.oracle_pubkey,
      customerPubkey: payload.requester_pubkey ?? "sender_pubkey",
    };

    expect(request.eventId).toBe("event123");
    expect(request.oraclePubkey).toBe(trustedOracle);
    expect(request.customerPubkey).toBe("requester_pub");
  });

  test("parseQueryRequestPayload rejects invalid JSON", () => {
    expect(() => parseQueryRequestPayload("not json")).toThrow();
  });

  test("parseQueryRequestPayload handles minimal payload", () => {
    const minimal = JSON.stringify({
      description: "test",
      nonce: "X",
      expires_at: Date.now() + 600_000,
    });
    const parsed = parseQueryRequestPayload(minimal);
    expect(parsed.description).toBe("test");
    expect(parsed.oracle_pubkey).toBeUndefined();
  });
});
