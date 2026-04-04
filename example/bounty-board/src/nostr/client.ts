import { SimplePool, type SubCloser } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event, VerifiedEvent } from "nostr-tools/core";
import { ANCHR_QUERY_REQUEST, ANCHR_QUERY_FEEDBACK } from "./events";
import { useSettingsStore } from "../store/settings";

let _pool: SimplePool | null = null;

function getPool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

function getRelayUrls(): string[] {
  return useSettingsStore.getState().relayUrls;
}

export async function publishEvent(
  event: VerifiedEvent,
  relayUrls?: string[],
): Promise<{ successes: string[]; failures: string[] }> {
  const urls = relayUrls ?? getRelayUrls();
  if (urls.length === 0) return { successes: [], failures: ["No relays configured"] };

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

export function subscribeToQueries(
  onEvent: (event: Event) => void,
  options?: { regionCode?: string; relayUrls?: string[] },
): SubCloser {
  const urls = options?.relayUrls ?? getRelayUrls();
  const pool = getPool();

  const filter: Filter = {
    kinds: [ANCHR_QUERY_REQUEST],
    "#t": ["anchr"],
    since: Math.floor(Date.now() / 1000) - 3600,
  };

  if (options?.regionCode) {
    filter["#region"] = [options.regionCode.toUpperCase()];
  }

  return pool.subscribeMany(urls, filter, { onevent: onEvent });
}

export function subscribeToFeedback(
  queryEventId: string,
  onEvent: (event: Event) => void,
  relayUrls?: string[],
): SubCloser {
  const urls = relayUrls ?? getRelayUrls();
  const pool = getPool();

  return pool.subscribeMany(urls, {
    kinds: [ANCHR_QUERY_FEEDBACK],
    "#e": [queryEventId],
  }, { onevent: onEvent });
}

export async function fetchRecentQueries(
  options?: { regionCode?: string; limit?: number; relayUrls?: string[] },
): Promise<Event[]> {
  const urls = options?.relayUrls ?? getRelayUrls();
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

export function closePool(): void {
  if (_pool) {
    _pool.close([]);
    _pool = null;
  }
}
