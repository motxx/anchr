/**
 * Nostr relay client for Ground Truth Protocol (NIP-90 DVM).
 *
 * Handles connection to multiple relays, event publishing,
 * and subscription management. Event kinds follow the NIP-90
 * Data Vending Machine spec (5300/6300/7000).
 */

import { SimplePool, type SubCloser } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event, VerifiedEvent } from "nostr-tools/core";
import { GT_QUERY_REQUEST, GT_QUERY_RESPONSE, GT_QUERY_SETTLEMENT } from "./events";
import { GT_ORACLE_ATTESTATION } from "./oracle-attestation";

export interface NostrClientConfig {
  relayUrls: string[];
}

export function getNostrConfig(): NostrClientConfig | null {
  const relayUrls = process.env.NOSTR_RELAYS?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  if (!relayUrls || relayUrls.length === 0) return null;

  return { relayUrls };
}

let _pool: SimplePool | null = null;

function getPool(): SimplePool {
  if (!_pool) {
    _pool = new SimplePool();
  }
  return _pool;
}

/**
 * Publish an event to all configured relays.
 */
export async function publishEvent(
  event: VerifiedEvent,
  relayUrls?: string[],
): Promise<{ successes: string[]; failures: string[] }> {
  const config = getNostrConfig();
  const urls = relayUrls ?? config?.relayUrls;
  if (!urls || urls.length === 0) {
    return { successes: [], failures: ["No relays configured"] };
  }

  const pool = getPool();
  const successes: string[] = [];
  const failures: string[] = [];

  const results = await Promise.allSettled(
    pool.publish(urls, event as unknown as Event),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === "fulfilled") {
      successes.push(urls[i]!);
    } else {
      failures.push(`${urls[i]}: ${result.reason}`);
    }
  }

  return { successes, failures };
}

/**
 * Subscribe to Ground Truth query request events (DVM kind 5300).
 */
export function subscribeToQueries(
  onEvent: (event: Event) => void,
  options?: {
    regionCode?: string;
    relayUrls?: string[];
  },
): SubCloser {
  const config = getNostrConfig();
  const urls = options?.relayUrls ?? config?.relayUrls ?? [];
  const pool = getPool();

  const filter: Filter = {
    kinds: [GT_QUERY_REQUEST],
    "#t": ["ground-truth"],
    since: Math.floor(Date.now() / 1000) - 3600, // last hour
  };

  if (options?.regionCode) {
    filter["#region"] = [options.regionCode.toUpperCase()];
  }

  return pool.subscribeMany(urls, filter, {
    onevent: onEvent,
  });
}

/**
 * Subscribe to responses for a specific query (DVM kind 6300).
 */
export function subscribeToResponses(
  queryEventId: string,
  onEvent: (event: Event) => void,
  relayUrls?: string[],
): SubCloser {
  const config = getNostrConfig();
  const urls = relayUrls ?? config?.relayUrls ?? [];
  const pool = getPool();

  return pool.subscribeMany(urls, {
    kinds: [GT_QUERY_RESPONSE],
    "#e": [queryEventId],
  }, {
    onevent: onEvent,
  });
}

/**
 * Subscribe to settlements for a specific query (DVM kind 7000).
 */
export function subscribeToSettlements(
  queryEventId: string,
  onEvent: (event: Event) => void,
  relayUrls?: string[],
): SubCloser {
  const config = getNostrConfig();
  const urls = relayUrls ?? config?.relayUrls ?? [];
  const pool = getPool();

  return pool.subscribeMany(urls, {
    kinds: [GT_QUERY_SETTLEMENT],
    "#e": [queryEventId],
  }, {
    onevent: onEvent,
  });
}

/**
 * Subscribe to oracle attestations for a specific query.
 */
export function subscribeToAttestations(
  queryEventId: string,
  onEvent: (event: Event) => void,
  relayUrls?: string[],
): SubCloser {
  const config = getNostrConfig();
  const urls = relayUrls ?? config?.relayUrls ?? [];
  const pool = getPool();

  return pool.subscribeMany(urls, {
    kinds: [GT_ORACLE_ATTESTATION],
    "#e": [queryEventId],
  }, {
    onevent: onEvent,
  });
}

/**
 * Fetch recent query events from relays.
 */
export async function fetchRecentQueries(
  options?: {
    regionCode?: string;
    limit?: number;
    relayUrls?: string[];
  },
): Promise<Event[]> {
  const config = getNostrConfig();
  const urls = options?.relayUrls ?? config?.relayUrls ?? [];
  const pool = getPool();

  const filter: Filter = {
    kinds: [GT_QUERY_REQUEST],
    "#t": ["ground-truth"],
    since: Math.floor(Date.now() / 1000) - 3600,
    limit: options?.limit ?? 50,
  };

  if (options?.regionCode) {
    filter["#region"] = [options.regionCode.toUpperCase()];
  }

  return pool.querySync(urls, filter);
}

/**
 * Check if Nostr relay connectivity is configured.
 */
export function isNostrEnabled(): boolean {
  return getNostrConfig() !== null;
}

/**
 * Close all relay connections.
 */
export function closePool(): void {
  if (_pool) {
    _pool.close([]);
    _pool = null;
  }
}
