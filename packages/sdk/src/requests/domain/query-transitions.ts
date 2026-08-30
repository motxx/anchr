import type { QueryStatus } from "./types.ts";

/** Valid state transitions for Simple (non-HTLC) queries. */
const SIMPLE_TRANSITIONS: Record<string, QueryStatus[]> = {
  pending: ["approved", "rejected", "expired"],
};

/** Valid state transitions for HTLC queries. */
const ESCROW_TRANSITIONS: Record<string, QueryStatus[]> = {
  awaiting_offers: ["provider_selected", "expired"],
  provider_selected: ["processing", "expired"],
  processing: ["verifying", "expired"],
  verifying: ["approved", "rejected", "expired"],
};

/** Terminal states — no further transitions allowed. */
const TERMINAL_STATUSES: QueryStatus[] = ["approved", "rejected", "expired"];

const OPEN_STATUSES: QueryStatus[] = [
  "pending",
  "awaiting_offers",
  "provider_selected",
  "processing",
];

const EXPIRABLE_STATUSES: QueryStatus[] = [
  "pending",
  "awaiting_offers",
  "provider_selected",
  "processing",
  "verifying",
];

export function isValidTransition(
  from: QueryStatus,
  to: QueryStatus,
  isHtlc: boolean,
): boolean {
  const table = isHtlc ? ESCROW_TRANSITIONS : SIMPLE_TRANSITIONS;
  return table[from]?.includes(to) ?? false;
}

export function isExpirable(status: QueryStatus): boolean {
  return EXPIRABLE_STATUSES.includes(status);
}

export function isTerminal(status: QueryStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Pre-verification, non-terminal statuses: the query can still be
 * cancelled. `verifying` has forward transitions but is not open —
 * once a result is under verification, cancellation is no longer
 * allowed.
 */
export function isOpenStatus(status: QueryStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
