import { useCallback } from "react";
import { publishEvent as nostrPublish } from "../nostr/client";
import { useSettingsStore } from "../store/settings";
import type { VerifiedEvent } from "nostr-tools/core";

export function useRelay() {
  const relayUrls = useSettingsStore((s) => s.relayUrls);

  const publish = useCallback(
    async (event: VerifiedEvent) => {
      return nostrPublish(event, relayUrls);
    },
    [relayUrls],
  );

  return { relayUrls, publish };
}
