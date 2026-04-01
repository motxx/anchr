import { useEffect, useRef } from "react";
import type { SubCloser } from "nostr-tools/pool";
import type { Event } from "nostr-tools/core";
import { subscribeToQueries, subscribeToFeedback } from "../nostr/client";
import { useSettingsStore } from "../store/settings";

export function useQuerySubscription(onEvent: (event: Event) => void, enabled = true) {
  const relayUrls = useSettingsStore((s) => s.relayUrls);
  const subRef = useRef<SubCloser | null>(null);

  useEffect(() => {
    if (!enabled || relayUrls.length === 0) return;

    subRef.current = subscribeToQueries(onEvent, { relayUrls });
    return () => {
      subRef.current?.close();
    };
  }, [enabled, relayUrls, onEvent]);
}

export function useFeedbackSubscription(
  queryEventId: string | null,
  onEvent: (event: Event) => void,
) {
  const relayUrls = useSettingsStore((s) => s.relayUrls);
  const subRef = useRef<SubCloser | null>(null);

  useEffect(() => {
    if (!queryEventId || relayUrls.length === 0) return;

    subRef.current = subscribeToFeedback(queryEventId, onEvent, relayUrls);
    return () => {
      subRef.current?.close();
    };
  }, [queryEventId, relayUrls, onEvent]);
}
