/**
 * Concrete Nostr relay transport binding for the SDK.
 *
 * Owns SimplePool lifecycle for publish/subscribe over relay URLs.
 * Protocol primitives (kinds, keys, NIP-44, tag helpers) come from
 * `@anchr/protocol/nostr`; this module is runtime I/O binding only.
 *
 * Durability contract: this client does NOT auto-reconnect or replay
 * missed events (beyond SimplePool's socket handling). A long-running
 * host that must not miss events either runs relays that persist and
 * replay (resubscribe with a `since` watermark after a reconnect) or
 * wraps this client with its own reconnect/watermark layer.
 */

import { SimplePool } from "nostr-tools/pool";
import type { Event } from "@anchr/protocol/nostr";
import type {
  Filter,
  PublishResult,
  RelayClient,
  Subscription,
} from "../types.ts";

export type {
  Filter,
  PublishResult,
  RelayClient,
  Subscription,
} from "../types.ts";

/** Construct a long-lived relay client over the given relay URLs. */
export function createRelayClient(relays: readonly string[]): RelayClient {
  const pool = new SimplePool();
  const relayList = [...relays];

  return {
    async publish(event: Event): Promise<PublishResult> {
      const promises = pool.publish(relayList, event);
      const results = await Promise.allSettled(promises);
      const successes: string[] = [];
      const failures: { relay: string; reason: string }[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          successes.push(relayList[i]);
        } else {
          failures.push({
            relay: relayList[i],
            reason: String(r.reason ?? "unknown"),
          });
        }
      });
      return { successes, failures };
    },

    subscribe(
      filter: Filter,
      onEvent: (event: Event) => void,
      onEose?: () => void,
    ): Subscription {
      const sub = pool.subscribe(relayList, filter, {
        onevent: onEvent,
        oneose: onEose,
      });
      return { close: () => sub.close() };
    },

    close(): void {
      pool.close(relayList);
    },
  };
}
