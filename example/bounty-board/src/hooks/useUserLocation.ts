import { useEffect, useState } from "react";
import { locationProvider } from "../platform/location";
import type { GpsCoord } from "../api/types";

export function useUserLocation() {
  const [location, setLocation] = useState<GpsCoord | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const granted = await locationProvider.requestPermission().catch(() => false);
      if (!granted || cancelled) return;
      try {
        const coord = await locationProvider.getCurrentPosition();
        if (!cancelled) setLocation(coord);
      } catch {
        // Location unavailable
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return location;
}
