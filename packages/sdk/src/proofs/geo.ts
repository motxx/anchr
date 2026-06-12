/** Outcome of comparing a reported GPS position against a distance policy. */
export interface GpsDistancePolicyResult {
  distanceKm: number;
  withinLimit: boolean;
}

/**
 * Single owner of the GPS distance-policy decision: haversine distance
 * compared against a km limit. Every factor (body GPS, C2PA-signed GPS,
 * EXIF GPS) delegates here so the threshold semantics cannot drift.
 */
export function evaluateGpsDistancePolicy(
  gps: { lat: number; lon: number },
  expected: { lat: number; lon: number },
  maxDistanceKm: number,
): GpsDistancePolicyResult {
  const distanceKm = haversineKm(gps.lat, gps.lon, expected.lat, expected.lon);
  return { distanceKm, withinLimit: distanceKm <= maxDistanceKm };
}

/**
 * Haversine distance in km between two GPS coordinates.
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
