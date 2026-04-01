import { useEffect, useRef } from "react";
import { notificationProvider } from "../platform/notifications";
import { haversineKm } from "../utils/distance";
import type { GpsCoord, QuerySummary } from "../api/types";

const NEARBY_RADIUS_KM = 10;

notificationProvider.configureForegroundHandler();

export function useNearbyNotifications(
  queries: QuerySummary[] | undefined,
  userLocation: GpsCoord | null,
) {
  const notifiedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!queries || !userLocation) return;

    for (const query of queries) {
      if (notifiedIds.current.has(query.id)) continue;
      if (!query.expected_gps) continue;

      const distance = haversineKm(userLocation, query.expected_gps);
      if (distance > NEARBY_RADIUS_KM) continue;

      notifiedIds.current.add(query.id);

      notificationProvider.scheduleImmediate({
        title: "Near you",
        subtitle: query.location_hint ?? undefined,
        body: `${query.description}${query.bounty ? ` — ${query.bounty.amount_sats} sats` : ""}`,
        data: { queryId: query.id },
      });
    }
  }, [queries, userLocation]);
}
