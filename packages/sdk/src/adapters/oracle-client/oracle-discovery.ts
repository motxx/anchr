/**
 * Oracle discovery via Nostr relays (the oracle-registry spec).
 *
 * Queries relays for kind 30088 Oracle Announcement events
 * and parses them into typed OracleAnnouncement objects.
 */

import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { KIND_ORACLE_ANNOUNCEMENT } from "@anchr/protocol/nostr";
import { VERIFICATION_FACTORS, type VerificationFactor } from "../../values.ts";
import type { EscrowType } from "../../requests/domain/types.ts";
import {
  isRecord,
  optionalNumber,
  optionalString,
  requireNumber,
  requireString,
} from "../../internal/runtime/types.ts";

const VERIFICATION_FACTOR_VALUES = new Set<string>(VERIFICATION_FACTORS);
const ESCROW_TYPE_VALUES = new Set<string>(["htlc", "p2pk_frost"]);
const RELAY_CLOSE_GRACE_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVerificationFactor(x: unknown): x is VerificationFactor {
  return typeof x === "string" && VERIFICATION_FACTOR_VALUES.has(x);
}

function isEscrowType(x: unknown): x is EscrowType {
  return typeof x === "string" && ESCROW_TYPE_VALUES.has(x);
}

function filterVerificationFactors(value: unknown): VerificationFactor[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isVerificationFactor);
}

function filterEscrowTypes(value: unknown): EscrowType[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isEscrowType);
}

/** Parsed oracle announcement from a Nostr kind 30088 event. */
export interface OracleAnnouncement {
  id: string;
  name: string;
  endpoint?: string;
  fee_ppm: number;
  supported_factors: VerificationFactor[];
  supported_escrow_types: EscrowType[];
  min_amount_sats?: number;
  max_amount_sats?: number;
  description?: string;
  /** Nostr pubkey (hex) of the Oracle that published this announcement. */
  pubkey: string;
  /** Unix timestamp when the announcement was created. */
  announced_at: number;
}

/**
 * Parse a kind 30088 Nostr event into an OracleAnnouncement.
 * Returns null if the event content is malformed.
 */
export function parseOracleAnnouncementEvent(
  event: Event,
): OracleAnnouncement | null {
  // Extract oracle id from the `d` tag
  const dTag = event.tags.find((t) => t[0] === "d");
  if (!dTag || !dTag[1]) return null;

  try {
    const content: unknown = JSON.parse(event.content);
    if (!isRecord(content)) return null;

    return {
      id: dTag[1],
      name: requireString(content, "name"),
      endpoint: optionalString(content, "endpoint"),
      fee_ppm: requireNumber(content, "fee_ppm"),
      supported_factors: filterVerificationFactors(content.supported_factors),
      supported_escrow_types: filterEscrowTypes(content.supported_escrow_types),
      min_amount_sats: optionalNumber(content, "min_amount_sats"),
      max_amount_sats: optionalNumber(content, "max_amount_sats"),
      description: optionalString(content, "description"),
      pubkey: event.pubkey,
      announced_at: event.created_at,
    };
  } catch {
    return null;
  }
}

/**
 * Discover oracles by querying Nostr relays for kind 30088 events
 * tagged with `anchr-oracle`.
 *
 * Optionally filter by capability (e.g., `tlsn`, `gps`).
 */
export async function discoverOracles(
  relayUrls: string[],
  options?: {
    /** Filter by specific verification factor capability. */
    factor?: VerificationFactor;
    /** Only return announcements newer than this unix timestamp. */
    since?: number;
    /** Maximum number of events to fetch. */
    limit?: number;
  },
): Promise<OracleAnnouncement[]> {
  if (relayUrls.length === 0) return [];

  const pool = new SimplePool();

  try {
    const tag = options?.factor
      ? `anchr-oracle-${options.factor}`
      : "anchr-oracle";

    const filter: Filter = {
      kinds: [KIND_ORACLE_ANNOUNCEMENT],
      "#t": [tag],
    };

    if (options?.since !== undefined) {
      filter.since = options.since;
    }
    if (options?.limit !== undefined) {
      filter.limit = options.limit;
    }

    const events = await pool.querySync(relayUrls, filter);

    const announcements: OracleAnnouncement[] = [];
    for (const event of events) {
      const parsed = parseOracleAnnouncementEvent(event);
      if (parsed) announcements.push(parsed);
    }

    // Sort by most recent first
    announcements.sort((a, b) => b.announced_at - a.announced_at);

    return announcements;
  } finally {
    pool.close(relayUrls);
    await delay(RELAY_CLOSE_GRACE_MS);
  }
}
