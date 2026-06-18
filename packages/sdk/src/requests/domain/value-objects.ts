import type { OfferInfo, PaymentLockInfo, QueryInput } from "./types.ts";
import { isSchemaUri } from "../../schema.ts";

/** Minimum locktime in seconds (10 minutes). Applies to all Payment Lock variants. */
export const MIN_ESCROW_LOCKTIME_SECS = 600;

/** Validate payment_lock info. Returns error string or null if valid. */
export function validateBountyInfo(input: PaymentLockInfo): string | null {
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
  if (input.schema !== undefined && !isSchemaUri(input.schema)) {
    return "schema must be a valid schema URI";
  }
  return null;
}

/** Validate offer info. Returns error string or null if valid. */
export function validateOfferInfo(offer: OfferInfo): string | null {
  if (!offer.provider_pubkey || offer.provider_pubkey.trim().length === 0) {
    return "provider_pubkey must not be empty";
  }
  if (!offer.offer_event_id || offer.offer_event_id.trim().length === 0) {
    return "offer_event_id must not be empty";
  }
  return null;
}
