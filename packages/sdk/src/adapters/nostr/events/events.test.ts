import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateEphemeralIdentity } from "../../../identity.ts";
import { KIND_ORACLE_ANNOUNCEMENT } from "@anchr/protocol/nostr";
import { buildOracleAnnouncementEvent } from "./events.ts";

describe("oracle announcement events", () => {
  test("buildOracleAnnouncementEvent emits kind 30088 with capability tags", () => {
    const oracle = generateEphemeralIdentity();
    const event = buildOracleAnnouncementEvent(oracle, {
      id: "oracle-1",
      name: "Test Oracle",
      fee_ppm: 50_000,
      supported_factors: ["tlsn"],
      supported_escrow_types: ["htlc"],
    }, ["wss://relay.example"]);

    expect(event.kind).toBe(KIND_ORACLE_ANNOUNCEMENT);
    expect(event.tags).toContainEqual(["d", "oracle-1"]);
    expect(event.tags).toContainEqual(["t", "anchr-oracle"]);
    expect(event.tags).toContainEqual(["t", "anchr-oracle-tlsn"]);
    expect(event.tags).toContainEqual(["relay", "wss://relay.example"]);
    const content = JSON.parse(event.content);
    expect(content.name).toBe("Test Oracle");
    expect(content.fee_ppm).toBe(50_000);
  });
});
