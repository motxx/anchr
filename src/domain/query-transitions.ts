import type { QueryStatus } from "./types";

/** Valid state transitions for Simple (non-HTLC) queries. */
const SIMPLE_TRANSITIONS: Record<string, QueryStatus[]> = {
  pending: ["approved", "rejected", "expired"],
};

/** Valid state transitions for HTLC queries. */
const HTLC_TRANSITIONS: Record<string, QueryStatus[]> = {
  awaiting_quotes: ["processing", "expired"],
  processing: ["verifying", "expired"],
  verifying: ["approved", "rejected", "expired"],
};

/** Terminal states — no further transitions allowed. */
const TERMINAL_STATUSES: QueryStatus[] = ["approved", "rejected", "expired"];

/** Statuses that can be cancelled. */
const CANCELLABLE_STATUSES: QueryStatus[] = ["pending", "awaiting_quotes", "worker_selected", "processing"];

/** Statuses that can be expired (same as cancellable). */
const EXPIRABLE_STATUSES: QueryStatus[] = ["pending", "awaiting_quotes", "worker_selected", "processing", "verifying"];

/** Check if a state transition is valid. */
export function isValidTransition(from: QueryStatus, to: QueryStatus, isHtlc: boolean): boolean {
  const table = isHtlc ? HTLC_TRANSITIONS : SIMPLE_TRANSITIONS;
  return table[from]?.includes(to) ?? false;
}

/** Check if a query in the given status can be cancelled. */
export function isCancellable(status: QueryStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

/** Check if a query in the given status can be expired. */
export function isExpirable(status: QueryStatus): boolean {
  return EXPIRABLE_STATUSES.includes(status);
}

/** Check if the given status is terminal (no further transitions). */
export function isTerminal(status: QueryStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Check if the given status is an open (active, non-terminal) status. */
export function isOpenStatus(status: QueryStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}
