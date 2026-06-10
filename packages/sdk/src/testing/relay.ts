/**
 * Deterministic in-memory RelayClient for tests, smoke harnesses, and
 * simulations. Delivery is deferred a microtask so a publisher can finish
 * registering subscriptions before handlers run, mirroring real relay
 * asynchrony without sockets.
 */

import type {
  Filter,
  PublishResult,
  RelayClient,
  Subscription,
} from "../adapters/types.ts";

type RelayEvent = Parameters<RelayClient["publish"]>[0];

interface SubRecord {
  id: number;
  filter: Filter;
  onEvent: (event: RelayEvent) => void;
}

export function createInMemoryRelayClient(
  options: { relayUrl?: string } = {},
): RelayClient {
  const relayUrl = options.relayUrl ?? "mock://in-memory-relay";
  let subscriptions: SubRecord[] = [];
  let nextId = 1;

  return {
    publish(event: RelayEvent): Promise<PublishResult> {
      for (const sub of [...subscriptions]) {
        if (!matchesFilter(event, sub.filter)) continue;
        queueMicrotask(() => sub.onEvent(event));
      }
      return Promise.resolve({ successes: [relayUrl], failures: [] });
    },

    subscribe(
      filter: Filter,
      onEvent: (event: RelayEvent) => void,
    ): Subscription {
      const id = nextId;
      nextId += 1;
      subscriptions.push({ id, filter, onEvent });
      return {
        close: () => {
          subscriptions = subscriptions.filter((sub) => sub.id !== id);
        },
      };
    },

    close(): void {
      subscriptions = [];
    },
  };
}

function matchesFilter(event: RelayEvent, filter: Filter): boolean {
  if (filter.kinds !== undefined && !filter.kinds.includes(event.kind)) {
    return false;
  }
  if (filter.authors !== undefined && !filter.authors.includes(event.pubkey)) {
    return false;
  }
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith("#") || !isStringArray(values)) continue;
    const tag = key.slice(1);
    const eventValues = event.tags
      .filter((entry) => entry[0] === tag)
      .map((entry) => entry[1]);
    if (!values.some((value) => eventValues.includes(value))) return false;
  }
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string");
}
