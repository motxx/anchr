import { useMemo } from "react";
import { useQueries } from "./useQueries";
import { useUserLocation } from "./useUserLocation";
import { useFeedStore, type FeedFilter } from "../store/feed";
import { haversineKm } from "../utils/distance";
import { isExpired } from "../utils/time";
import type { QuerySummary, GpsCoord } from "../api/types";

const NEARBY_RADIUS_KM = 50;

function sortByFilter(queries: QuerySummary[], filter: FeedFilter, userLocation: GpsCoord | null): QuerySummary[] {
  const active = queries.filter((q) => !isExpired(q.expires_at));

  switch (filter) {
    case "nearby":
      if (!userLocation) return active;
      return active
        .filter((q) => q.expected_gps && haversineKm(userLocation, q.expected_gps) <= NEARBY_RADIUS_KM)
        .sort((a, b) => {
          const distA = a.expected_gps ? haversineKm(userLocation, a.expected_gps) : Infinity;
          const distB = b.expected_gps ? haversineKm(userLocation, b.expected_gps) : Infinity;
          return distA - distB;
        });

    case "new":
      return [...active].sort((a, b) => b.expires_at - a.expires_at);

    case "hot":
      return [...active].sort((a, b) => {
        const satsA = a.bounty?.amount_sats ?? 0;
        const satsB = b.bounty?.amount_sats ?? 0;
        return satsB - satsA;
      });

    case "photo":
      return active.filter((q) => !q.tlsn_requirements);

    case "web":
      return active.filter((q) => !!q.tlsn_requirements);

    default:
      return active;
  }
}

export function useBountyFeed() {
  const { data: queries, isLoading, error, refetch } = useQueries();
  const userLocation = useUserLocation();
  const activeFilter = useFeedStore((s) => s.activeFilter);

  const filtered = useMemo(
    () => sortByFilter(queries ?? [], activeFilter, userLocation),
    [queries, activeFilter, userLocation],
  );

  return {
    bounties: filtered,
    isLoading,
    error,
    refetch,
    userLocation,
    activeFilter,
  };
}
