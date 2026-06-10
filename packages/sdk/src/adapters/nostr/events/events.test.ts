import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateEphemeralIdentity } from "../../../identity.ts";
import { KIND_ORACLE_ANNOUNCEMENT } from "@anchr/protocol/nostr";
import {
  buildOracleAnnouncementEvent,
  type OracleResponsePayload,
  parseOracleResponsePayload,
} from "./events.ts";
import { deriveConversationKey, encryptNip44 } from "../crypto/encryption.ts";

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

describe("oracle response payload tag", () => {
  test("parseOracleResponsePayload decrypts the oracle_payload tag", () => {
    const provider = generateEphemeralIdentity();
    const oracle = generateEphemeralIdentity();
    const payload: OracleResponsePayload = {
      nonce_echo: "nonce-1",
      attachments: [{
        blossom_hash: "ab".repeat(32),
        blossom_urls: ["https://blossom.example/abc"],
        decrypt_key_oracle: "key",
        decrypt_iv: "iv",
        mime: "image/jpeg",
      }],
    };
    const conversationKey = deriveConversationKey(
      provider.secretKey,
      oracle.publicKey,
    );
    const event = {
      pubkey: provider.publicKey,
      tags: [[
        "oracle_payload",
        encryptNip44(JSON.stringify(payload), conversationKey),
      ]],
    };
    const parsed = parseOracleResponsePayload(event, oracle.secretKey);
    expect(parsed).toEqual(payload);
  });

  test("parseOracleResponsePayload returns null without the tag", () => {
    const oracle = generateEphemeralIdentity();
    expect(
      parseOracleResponsePayload(
        { pubkey: "00".repeat(32), tags: [] },
        oracle.secretKey,
      ),
    ).toBe(null);
  });
});
