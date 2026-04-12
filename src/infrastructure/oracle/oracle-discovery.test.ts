import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateEphemeralIdentity } from "../nostr/identity";
import { buildOracleAnnouncementEvent } from "../nostr/event-builders";
import { ANCHR_ORACLE_ANNOUNCEMENT } from "../nostr/events";
import { parseOracleAnnouncementEvent } from "./oracle-discovery";
import type { OracleInfo } from "../../domain/oracle-types";

const FULL_ORACLE_INFO: OracleInfo = {
  id: "test-oracle",
  name: "Test Oracle",
  endpoint: "https://oracle.example.com",
  fee_ppm: 50000,
  supported_factors: ["tlsn", "gps", "nonce"],
  supported_escrow_types: ["htlc", "p2pk_frost"],
  min_bounty_sats: 100,
  max_bounty_sats: 1000000,
  description: "A test oracle for unit tests",
};

test("buildOracleAnnouncementEvent produces kind 30088", () => {
  const identity = generateEphemeralIdentity();
  const event = buildOracleAnnouncementEvent(identity, FULL_ORACLE_INFO);

  expect(event.kind).toBe(ANCHR_ORACLE_ANNOUNCEMENT);
  expect(event.kind).toBe(30088);
});

test("buildOracleAnnouncementEvent sets d tag to oracle id", () => {
  const identity = generateEphemeralIdentity();
  const event = buildOracleAnnouncementEvent(identity, FULL_ORACLE_INFO);

  const dTag = event.tags.find((t) => t[0] === "d");
  expect(dTag).toBeDefined();
  expect(dTag![1]).toBe("test-oracle");
});

test("buildOracleAnnouncementEvent includes anchr-oracle t tag", () => {
  const identity = generateEphemeralIdentity();
  const event = buildOracleAnnouncementEvent(identity, FULL_ORACLE_INFO);

  const tTags = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
  expect(tTags).toContain("anchr-oracle");
});

test("buildOracleAnnouncementEvent includes capability t tags", () => {
  const identity = generateEphemeralIdentity();
  const event = buildOracleAnnouncementEvent(identity, FULL_ORACLE_INFO);

  const tTags = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
  expect(tTags).toContain("anchr-oracle-tlsn");
  expect(tTags).toContain("anchr-oracle-gps");
  expect(tTags).toContain("anchr-oracle-nonce");
});

test("buildOracleAnnouncementEvent content is valid JSON with announcement payload", () => {
  const identity = generateEphemeralIdentity();
  const event = buildOracleAnnouncementEvent(identity, FULL_ORACLE_INFO);

  const content = JSON.parse(event.content);
  expect(content.name).toBe("Test Oracle");
  expect(content.fee_ppm).toBe(50000);
  expect(content.supported_factors).toEqual(["tlsn", "gps", "nonce"]);
  expect(content.supported_escrow_types).toEqual(["htlc", "p2pk_frost"]);
  expect(content.min_bounty_sats).toBe(100);
  expect(content.max_bounty_sats).toBe(1000000);
  expect(content.description).toBe("A test oracle for unit tests");
  expect(content.endpoint).toBe("https://oracle.example.com");
});

test("buildOracleAnnouncementEvent includes relay tags when provided", () => {
  const identity = generateEphemeralIdentity();
  const relayUrls = ["wss://relay1.example.com", "wss://relay2.example.com"];
  const event = buildOracleAnnouncementEvent(identity, FULL_ORACLE_INFO, relayUrls);

  const relayTags = event.tags.filter((t) => t[0] === "relay").map((t) => t[1]);
  expect(relayTags).toEqual(relayUrls);
});

test("buildOracleAnnouncementEvent omits optional fields when not set", () => {
  const identity = generateEphemeralIdentity();
  const minimalInfo: OracleInfo = {
    id: "minimal-oracle",
    name: "Minimal",
    fee_ppm: 10000,
  };
  const event = buildOracleAnnouncementEvent(identity, minimalInfo);

  const content = JSON.parse(event.content);
  expect(content.name).toBe("Minimal");
  expect(content.fee_ppm).toBe(10000);
  expect(content.supported_factors).toEqual([]);
  expect(content.supported_escrow_types).toEqual([]);
  expect(content).not.toHaveProperty("endpoint");
  expect(content).not.toHaveProperty("min_bounty_sats");
  expect(content).not.toHaveProperty("max_bounty_sats");
  expect(content).not.toHaveProperty("description");
});

test("buildOracleAnnouncementEvent is signed by the identity", () => {
  const identity = generateEphemeralIdentity();
  const event = buildOracleAnnouncementEvent(identity, FULL_ORACLE_INFO);

  expect(event.pubkey).toBe(identity.publicKey);
  expect(event.sig).toBeDefined();
  expect(typeof event.sig).toBe("string");
  expect(event.sig.length).toBe(128); // 64-byte Schnorr sig in hex
});

test("parseOracleAnnouncementEvent parses a valid event", () => {
  const identity = generateEphemeralIdentity();
  const event = buildOracleAnnouncementEvent(identity, FULL_ORACLE_INFO);

  const announcement = parseOracleAnnouncementEvent(event);
  expect(announcement).not.toBeNull();
  expect(announcement!.id).toBe("test-oracle");
  expect(announcement!.name).toBe("Test Oracle");
  expect(announcement!.endpoint).toBe("https://oracle.example.com");
  expect(announcement!.fee_ppm).toBe(50000);
  expect(announcement!.supported_factors).toEqual(["tlsn", "gps", "nonce"]);
  expect(announcement!.supported_escrow_types).toEqual(["htlc", "p2pk_frost"]);
  expect(announcement!.min_bounty_sats).toBe(100);
  expect(announcement!.max_bounty_sats).toBe(1000000);
  expect(announcement!.description).toBe("A test oracle for unit tests");
  expect(announcement!.pubkey).toBe(identity.publicKey);
  expect(announcement!.announced_at).toBe(event.created_at);
});

test("parseOracleAnnouncementEvent returns null for invalid content", () => {
  const badEvent = {
    kind: 30088,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", "bad-oracle"]],
    content: "not-json",
    pubkey: "aabbcc",
    id: "fake",
    sig: "fake",
  };

  const result = parseOracleAnnouncementEvent(badEvent);
  expect(result).toBeNull();
});

test("parseOracleAnnouncementEvent returns null when d tag is missing", () => {
  const event = {
    kind: 30088,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["t", "anchr-oracle"]],
    content: JSON.stringify({ name: "No D Tag", fee_ppm: 1000 }),
    pubkey: "aabbcc",
    id: "fake",
    sig: "fake",
  };

  const result = parseOracleAnnouncementEvent(event);
  expect(result).toBeNull();
});

test("parseOracleAnnouncementEvent returns null when required fields are missing", () => {
  const event = {
    kind: 30088,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", "incomplete"]],
    content: JSON.stringify({ name: "Incomplete" }),
    pubkey: "aabbcc",
    id: "fake",
    sig: "fake",
  };

  const result = parseOracleAnnouncementEvent(event);
  expect(result).toBeNull();
});

test("parseOracleAnnouncementEvent handles minimal content gracefully", () => {
  const event = {
    kind: 30088,
    created_at: 1700000000,
    tags: [["d", "minimal"]],
    content: JSON.stringify({ name: "Minimal", fee_ppm: 5000 }),
    pubkey: "deadbeef",
    id: "fake",
    sig: "fake",
  };

  const result = parseOracleAnnouncementEvent(event);
  expect(result).not.toBeNull();
  expect(result!.id).toBe("minimal");
  expect(result!.name).toBe("Minimal");
  expect(result!.fee_ppm).toBe(5000);
  expect(result!.supported_factors).toEqual([]);
  expect(result!.supported_escrow_types).toEqual([]);
  expect(result!.endpoint).toBeUndefined();
  expect(result!.min_bounty_sats).toBeUndefined();
  expect(result!.max_bounty_sats).toBeUndefined();
  expect(result!.description).toBeUndefined();
});

test("round-trip: build then parse preserves all fields", () => {
  const identity = generateEphemeralIdentity();
  const event = buildOracleAnnouncementEvent(identity, FULL_ORACLE_INFO);
  const parsed = parseOracleAnnouncementEvent(event);

  expect(parsed).not.toBeNull();
  expect(parsed!.id).toBe(FULL_ORACLE_INFO.id);
  expect(parsed!.name).toBe(FULL_ORACLE_INFO.name);
  expect(parsed!.endpoint).toBe(FULL_ORACLE_INFO.endpoint);
  expect(parsed!.fee_ppm).toBe(FULL_ORACLE_INFO.fee_ppm);
  expect(parsed!.supported_factors).toEqual(FULL_ORACLE_INFO.supported_factors);
  expect(parsed!.supported_escrow_types).toEqual(FULL_ORACLE_INFO.supported_escrow_types);
  expect(parsed!.min_bounty_sats).toBe(FULL_ORACLE_INFO.min_bounty_sats);
  expect(parsed!.max_bounty_sats).toBe(FULL_ORACLE_INFO.max_bounty_sats);
  expect(parsed!.description).toBe(FULL_ORACLE_INFO.description);
  expect(parsed!.pubkey).toBe(identity.publicKey);
});
