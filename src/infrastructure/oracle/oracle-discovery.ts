/**
 * Oracle discovery via Nostr relays (Spec 08).
 *
 * Queries relays for kind 30088 Oracle Announcement events
 * and parses them into typed OracleAnnouncement objects.
 */

import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { ANCHR_ORACLE_ANNOUNCEMENT } from "../nostr/events";
import type { EscrowType, VerificationFactor } from "../../domain/types";

/** Parsed oracle announcement from a Nostr kind 30088 event. */
export interface OracleAnnouncement {
  id: string;
  name: string;
  endpoint?: string;
  fee_ppm: number;
  supported_factors: VerificationFactor[];
  supported_escrow_types: EscrowType[];
  min_bounty_sats?: number;
  max_bounty_sats?: number;
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
export function parseOracleAnnouncementEvent(event: Event): OracleAnnouncement | null {
  // Extract oracle id from the `d` tag
  const dTag = event.tags.find((t) => t[0] === "d");
  if (!dTag || !dTag[1]) return null;

  try {
    const content = JSON.parse(event.content) as Record<string, unknown>;

    if (typeof content.name !== "string" || typeof content.fee_ppm !== "number") {
      return null;
    }

    return {
      id: dTag[1],
      name: content.name as string,
      endpoint: typeof content.endpoint === "string" ? content.endpoint : undefined,
      fee_ppm: content.fee_ppm as number,
      supported_factors: Array.isArray(content.supported_factors)
        ? (content.supported_factors as VerificationFactor[])
        : [],
      supported_escrow_types: Array.isArray(content.supported_escrow_types)
        ? (content.supported_escrow_types as EscrowType[])
        : [],
      min_bounty_sats: typeof content.min_bounty_sats === "number" ? content.min_bounty_sats : undefined,
      max_bounty_sats: typeof content.max_bounty_sats === "number" ? content.max_bounty_sats : undefined,
      description: typeof content.description === "string" ? content.description : undefined,
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
      kinds: [ANCHR_ORACLE_ANNOUNCEMENT],
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
  }
}
