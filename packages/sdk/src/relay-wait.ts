/**
 * The one subscribe-with-deadline helper for the paid-request lifecycle.
 * Subscribes, resolves with the first event the matcher accepts, and
 * resolves null when the deadline passes. `cancel()` aborts early (used
 * when a preceding publish fails).
 */

import type { Event } from "@anchr/protocol/nostr";
import type { Filter, RelayClient } from "./adapters/types.ts";

export interface EventWait<T> {
  result: Promise<T | null>;
  cancel(): void;
}

export function waitForFirstEvent<T>(
  relayClient: RelayClient,
  filter: Filter,
  match: (event: Event) => T | null,
  timeoutMs: number,
): EventWait<T> {
  let settle: ((value: T | null) => void) | undefined;
  const handles: {
    sub?: { close(): void };
    timeoutId?: ReturnType<typeof setTimeout>;
  } = {};
  const finish = (value: T | null) => {
    handles.sub?.close();
    if (handles.timeoutId !== undefined) clearTimeout(handles.timeoutId);
    settle?.(value);
    settle = undefined;
  };
  const result = new Promise<T | null>((resolve) => {
    settle = resolve;
    handles.sub = relayClient.subscribe(filter, (event) => {
      const value = match(event);
      if (value === null) return;
      finish(value);
    });
    handles.timeoutId = setTimeout(() => finish(null), timeoutMs);
  });
  return { result, cancel: () => finish(null) };
}
