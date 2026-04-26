/**
 * E2E tests for Spec 08 — Oracle Registry discovery via Nostr relay.
 *
 * Prerequisites:
 *   docker compose up -d          (provides relay at ws://localhost:7777)
 *
 * Run:
 *   NOSTR_RELAYS=ws://localhost:7777 deno test e2e/oracle-discovery.test.ts --allow-all
 */

import { afterAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { generateEphemeralIdentity } from "../src/infrastructure/nostr/identity.ts";
import { buildOracleAnnouncementEvent } from "../src/infrastructure/nostr/event-builders.ts";
import {
  discoverOracles,
  parseOracleAnnouncementEvent,
} from "../src/infrastructure/oracle/oracle-discovery.ts";
import { ANCHR_ORACLE_ANNOUNCEMENT } from "../src/infrastructure/nostr/events.ts";
import type { OracleInfo } from "../src/domain/oracle-types.ts";

// ---------------------------------------------------------------------------
// Relay connectivity
// ---------------------------------------------------------------------------

const NOSTR_RELAYS_ENV = Deno.env.get("NOSTR_RELAYS")?.trim();
const RELAY_URL = NOSTR_RELAYS_ENV?.split(",")[0]?.trim() ?? "ws://localhost:7777";

async function isRelayReachable(): Promise<boolean> {
  try {
    const ws = new WebSocket(RELAY_URL);
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => { ws.close(); resolve(false); }, 2000);
      ws.onopen = () => { clearTimeout(timeout); ws.close(); resolve(true); };
      ws.onerror = () => { clearTimeout(timeout); resolve(false); };
    });
  } catch {
    return false;
  }
}

const RELAY_REACHABLE = NOSTR_RELAYS_ENV ? await isRelayReachable() : false;

if (!NOSTR_RELAYS_ENV) {
  console.warn(
    `[e2e] NOSTR_RELAYS not set – oracle discovery tests skipped. Run: NOSTR_RELAYS=ws://localhost:7777 deno task test:e2e:relay`,
  );
} else if (!RELAY_REACHABLE) {
  console.warn(
    `[e2e] Relay not reachable at ${RELAY_URL} – oracle discovery tests skipped. Run: docker compose up -d`,
  );
}

const suite = RELAY_REACHABLE ? describe : describe.ignore;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Publish a signed event to the relay and wait for relay acceptance. */
async function publishToRelay(event: Event): Promise<void> {
  const pool = new SimplePool();
  try {
    await Promise.allSettled(pool.publish([RELAY_URL], event));
    // Allow the relay to index the event before querying.
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    pool.close([RELAY_URL]);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite(
  {
    name: "e2e: Spec 08 — Oracle Registry discovery",
    sanitizeOps: false,
    sanitizeResources: false,
  },
  () => {
    // Each test uses its own identity to avoid cross-test interference.

    test("relay is reachable", () => {
      expect(RELAY_REACHABLE).toBe(true);
    });

    test("publish oracle announcement and discover it", async () => {
      const identity = generateEphemeralIdentity();

      const oracleInfo: OracleInfo = {
        id: `e2e-oracle-${Date.now()}`,
        name: "E2E Test Oracle",
        endpoint: "https://oracle.example.com/api",
        fee_ppm: 50_000,
        supported_factors: ["tlsn", "gps"],
        supported_escrow_types: ["htlc"],
        min_bounty_sats: 1000,
        max_bounty_sats: 1_000_000,
        description: "Oracle for E2E testing",
      };

      const event = buildOracleAnnouncementEvent(identity, oracleInfo, [RELAY_URL]);
      await publishToRelay(event);

      const announcements = await discoverOracles([RELAY_URL], {
        since: Math.floor(Date.now() / 1000) - 60,
      });

      const found = announcements.find((a) => a.id === oracleInfo.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe("E2E Test Oracle");
      expect(found!.endpoint).toBe("https://oracle.example.com/api");
      expect(found!.fee_ppm).toBe(50_000);
      expect(found!.supported_factors).toEqual(["tlsn", "gps"]);
      expect(found!.supported_escrow_types).toEqual(["htlc"]);
      expect(found!.min_bounty_sats).toBe(1000);
      expect(found!.max_bounty_sats).toBe(1_000_000);
      expect(found!.description).toBe("Oracle for E2E testing");
      expect(found!.pubkey).toBe(identity.publicKey);
    });

    test("parseOracleAnnouncementEvent round-trips correctly", async () => {
      const identity = generateEphemeralIdentity();

      const oracleInfo: OracleInfo = {
        id: `e2e-parse-${Date.now()}`,
        name: "Parse Test Oracle",
        fee_ppm: 10_000,
        supported_factors: ["nonce"],
        supported_escrow_types: ["p2pk_frost"],
      };

      const event = buildOracleAnnouncementEvent(identity, oracleInfo, [RELAY_URL]);

      // Parse the locally-built event without relay round-trip
      const parsed = parseOracleAnnouncementEvent(event);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe(oracleInfo.id);
      expect(parsed!.name).toBe("Parse Test Oracle");
      expect(parsed!.fee_ppm).toBe(10_000);
      expect(parsed!.supported_factors).toEqual(["nonce"]);
      expect(parsed!.supported_escrow_types).toEqual(["p2pk_frost"]);
      expect(parsed!.endpoint).toBeUndefined();
      expect(parsed!.pubkey).toBe(identity.publicKey);
    });

    test("capability filtering: discover by factor tag", async () => {
      const identity = generateEphemeralIdentity();
      const uniqueSuffix = Date.now();

      // Oracle with tlsn capability
      const tlsnOracle: OracleInfo = {
        id: `e2e-tlsn-${uniqueSuffix}`,
        name: "TLSNotary Oracle",
        fee_ppm: 30_000,
        supported_factors: ["tlsn"],
        supported_escrow_types: ["htlc"],
      };

      // Oracle with gps-only capability
      const gpsOracle: OracleInfo = {
        id: `e2e-gps-${uniqueSuffix}`,
        name: "GPS Oracle",
        fee_ppm: 20_000,
        supported_factors: ["gps"],
        supported_escrow_types: ["htlc"],
      };

      const tlsnEvent = buildOracleAnnouncementEvent(identity, tlsnOracle, [RELAY_URL]);
      const gpsEvent = buildOracleAnnouncementEvent(identity, gpsOracle, [RELAY_URL]);

      await publishToRelay(tlsnEvent);
      await publishToRelay(gpsEvent);

      // Filter by tlsn — should find the TLSNotary oracle but not the GPS-only one
      const tlsnResults = await discoverOracles([RELAY_URL], {
        factor: "tlsn",
        since: Math.floor(Date.now() / 1000) - 60,
      });

      const foundTlsn = tlsnResults.find((a) => a.id === tlsnOracle.id);
      const foundGpsInTlsn = tlsnResults.find((a) => a.id === gpsOracle.id);

      expect(foundTlsn).toBeDefined();
      expect(foundTlsn!.name).toBe("TLSNotary Oracle");
      expect(foundGpsInTlsn).toBeUndefined();

      // Filter by gps — should find the GPS oracle but not the TLSNotary-only one
      const gpsResults = await discoverOracles([RELAY_URL], {
        factor: "gps",
        since: Math.floor(Date.now() / 1000) - 60,
      });

      const foundGps = gpsResults.find((a) => a.id === gpsOracle.id);
      const foundTlsnInGps = gpsResults.find((a) => a.id === tlsnOracle.id);

      expect(foundGps).toBeDefined();
      expect(foundGps!.name).toBe("GPS Oracle");
      expect(foundTlsnInGps).toBeUndefined();
    });

    test("parametrized replaceable: second announcement from same pubkey replaces first", async () => {
      const identity = generateEphemeralIdentity();
      const oracleId = `e2e-replace-${Date.now()}`;

      // First announcement
      const infoV1: OracleInfo = {
        id: oracleId,
        name: "Oracle V1",
        fee_ppm: 10_000,
        supported_factors: ["gps"],
        supported_escrow_types: ["htlc"],
        description: "First version",
      };

      const eventV1 = buildOracleAnnouncementEvent(identity, infoV1, [RELAY_URL]);
      await publishToRelay(eventV1);

      // Small delay so created_at differs
      await new Promise((r) => setTimeout(r, 1100));

      // Second announcement with same oracle id (same `d` tag) — should replace
      const infoV2: OracleInfo = {
        id: oracleId,
        name: "Oracle V2",
        fee_ppm: 25_000,
        supported_factors: ["gps", "tlsn"],
        supported_escrow_types: ["htlc", "p2pk_frost"],
        description: "Updated version",
      };

      const eventV2 = buildOracleAnnouncementEvent(identity, infoV2, [RELAY_URL]);
      await publishToRelay(eventV2);

      // Query — for a parametrized replaceable event (kind 30000-39999),
      // the relay should return only the latest event for a given (pubkey, kind, d-tag) tuple.
      const announcements = await discoverOracles([RELAY_URL], {
        since: Math.floor(Date.now() / 1000) - 120,
      });

      const matching = announcements.filter(
        (a) => a.id === oracleId && a.pubkey === identity.publicKey,
      );

      // Should be exactly one — the replacement
      expect(matching.length).toBe(1);
      expect(matching[0]!.name).toBe("Oracle V2");
      expect(matching[0]!.fee_ppm).toBe(25_000);
      expect(matching[0]!.supported_factors).toEqual(["gps", "tlsn"]);
      expect(matching[0]!.supported_escrow_types).toEqual(["htlc", "p2pk_frost"]);
      expect(matching[0]!.description).toBe("Updated version");
    });

    test("discoverOracles returns empty for no matching relays", async () => {
      const results = await discoverOracles([], { factor: "tlsn" });
      expect(results).toEqual([]);
    });
  },
);
