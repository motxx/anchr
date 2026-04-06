/**
 * Nostr relay client for Anchr (NIP-90 DVM).
 *
 * Handles connection to multiple relays, event publishing,
 * and subscription management. Event kinds follow the NIP-90
 * Data Vending Machine spec (5300/6300/7000).
 */

import { SimplePool, type SubCloser } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event, VerifiedEvent } from "nostr-tools/core";
import { ANCHR_QUERY_REQUEST, ANCHR_QUERY_RESPONSE, ANCHR_QUERY_FEEDBACK } from "./events";
import { DM_KIND } from "./dm";
import { ANCHR_ORACLE_ATTESTATION } from "./oracle-attestation";

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
 *
 * When `options.minSuccesses` is set, throws if fewer relays
 * than the threshold accepted the event.
 */
export async function publishEvent(
  event: VerifiedEvent,
  relayUrls?: string[],
  options?: { minSuccesses?: number },
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

  if (
    options?.minSuccesses !== undefined &&
    successes.length < options.minSuccesses
  ) {
    throw new Error(
      `publishEvent failed: ${successes.length} relay(s) succeeded, but at least ${options.minSuccesses} required`,
    );
  }

  return { successes, failures };
}

/**
 * Subscribe to Anchr query request events (DVM kind 5300).
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
    kinds: [ANCHR_QUERY_REQUEST],
    "#t": ["anchr"],
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
    kinds: [ANCHR_QUERY_RESPONSE],
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
    kinds: [ANCHR_QUERY_FEEDBACK],
    "#e": [queryEventId],
  }, {
    onevent: onEvent,
  });
}

/**
 * Subscribe to all feedback for a query (kind 7000): quotes, selection, completion.
 */
export function subscribeToFeedback(
  queryEventId: string,
  onEvent: (event: Event) => void,
  relayUrls?: string[],
): SubCloser {
  const config = getNostrConfig();
  const urls = relayUrls ?? config?.relayUrls ?? [];
  const pool = getPool();

  return pool.subscribeMany(urls, {
    kinds: [ANCHR_QUERY_FEEDBACK],
    "#e": [queryEventId],
  }, {
    onevent: onEvent,
  });
}

/**
 * Subscribe to NIP-44 DMs addressed to a specific pubkey (kind 4).
 * Used by Workers to receive preimage from Oracle.
 */
export function subscribeToDMs(
  recipientPubkey: string,
  onEvent: (event: Event) => void,
  relayUrls?: string[],
): SubCloser {
  const config = getNostrConfig();
  const urls = relayUrls ?? config?.relayUrls ?? [];
  const pool = getPool();

  return pool.subscribeMany(urls, {
    kinds: [DM_KIND],
    "#p": [recipientPubkey],
    since: Math.floor(Date.now() / 1000) - 3600,
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
    kinds: [ANCHR_ORACLE_ATTESTATION],
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
    kinds: [ANCHR_QUERY_REQUEST],
    "#t": ["anchr"],
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
