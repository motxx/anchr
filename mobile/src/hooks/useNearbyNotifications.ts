import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { haversineKm } from "../utils/distance";
import type { GpsCoord, QuerySummary } from "../api/types";

/** Radius in km to consider a query "nearby". */
const NEARBY_RADIUS_KM = 10;

// Configure notification handler to show even when app is foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Fires a local notification when a new query appears near the user.
 * Tracks already-notified query IDs to avoid duplicates.
 */
export function useNearbyNotifications(
  queries: QuerySummary[] | undefined,
  userLocation: GpsCoord | null,
) {
  const notifiedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!queries || !userLocation) return;

    for (const query of queries) {
      // Skip already notified
      if (notifiedIds.current.has(query.id)) continue;

      // Skip queries without GPS
      if (!query.expected_gps) continue;

      const distance = haversineKm(userLocation, query.expected_gps);
      if (distance > NEARBY_RADIUS_KM) continue;

      // Nearby query found — notify
      notifiedIds.current.add(query.id);

      Notifications.scheduleNotificationAsync({
        content: {
          title: "📍 Near you",
          subtitle: query.location_hint ?? undefined,
          body: `${query.description}${query.bounty ? ` — ${query.bounty.amount_sats} sats` : ""}`,
          data: { queryId: query.id },
        },
        trigger: null, // Fire immediately
      });
    }
  }, [queries, userLocation]);
}

/** Request notification permissions. Call once at app startup. */
export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}
