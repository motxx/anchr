import type { BountyInfo, GpsCoord, OfferInfo, QueryInput } from "./types.ts";

/** Minimum escrow locktime in seconds (10 minutes). Applies to all escrow types. */
export const MIN_ESCROW_LOCKTIME_SECS = 600;

/** Validate GPS coordinates. Returns error string or null if valid. */
export function validateGpsCoord(input: GpsCoord): string | null {
  if (!Number.isFinite(input.lat)) return "lat must be a finite number";
  if (!Number.isFinite(input.lon)) return "lon must be a finite number";
  if (input.lat < -90 || input.lat > 90) {
    return `lat must be between -90 and 90 (got ${input.lat})`;
  }
  if (input.lon < -180 || input.lon > 180) {
    return `lon must be between -180 and 180 (got ${input.lon})`;
  }
  return null;
}

/** Validate bounty info. Returns error string or null if valid. */
export function validateBountyInfo(input: BountyInfo): string | null {
  if (!Number.isFinite(input.amount_sats)) {
    return "amount_sats must be a finite number";
  }
  if (input.amount_sats <= 0) return "amount_sats must be positive";
  if (!Number.isInteger(input.amount_sats)) {
    return "amount_sats must be an integer";
  }
  return null;
}

/** Validate escrow locktime. Returns error string or null if valid. */
export function validateEscrowLocktime(
  locktime: number,
  nowSecs: number,
  minSecs: number,
): string | null {
  if (!Number.isFinite(locktime)) return "locktime must be a finite number";
  const remaining = locktime - nowSecs;
  if (remaining < minSecs) {
    return `escrow locktime must be at least ${minSecs}s in the future (got ${remaining}s)`;
  }
  return null;
}

/** Validate query input. Returns error string or null if valid. */
export function validateQueryInput(input: QueryInput): string | null {
  if (!input.description || input.description.trim().length === 0) {
    return "description must not be empty";
  }
  if (input.expected_gps) {
    const gpsError = validateGpsCoord(input.expected_gps);
    if (gpsError) return `expected_gps: ${gpsError}`;
  }
  if (input.max_gps_distance_km !== undefined) {
    if (!Number.isFinite(input.max_gps_distance_km)) {
      return "max_gps_distance_km must be a finite number";
    }
    if (input.max_gps_distance_km <= 0) {
      return "max_gps_distance_km must be positive";
    }
  }
  if (input.tlsn_requirements) {
    const url = input.tlsn_requirements.target_url;
    if (!url || url.trim().length === 0) {
      return "tlsn_requirements.target_url must not be empty";
    }
    try {
      new URL(url);
    } catch {
      return `tlsn_requirements.target_url is not a valid URL: ${url}`;
    }
    if (!input.visibility) {
      return "visibility is required when tlsn_requirements is set";
    }
  }
  return null;
}

/** Validate offer info. Returns error string or null if valid. */
export function validateOfferInfo(offer: OfferInfo): string | null {
  if (!offer.worker_pubkey || offer.worker_pubkey.trim().length === 0) {
    return "worker_pubkey must not be empty";
  }
  if (!offer.offer_event_id || offer.offer_event_id.trim().length === 0) {
    return "offer_event_id must not be empty";
  }
  return null;
}
