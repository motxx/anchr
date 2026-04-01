/** Truncate an npub or hex pubkey for display. */
export function truncateNpub(npub: string, chars = 8): string {
  if (npub.length <= chars * 2 + 3) return npub;
  return `${npub.slice(0, chars)}...${npub.slice(-chars)}`;
}

/** Format sats with locale-aware thousands separator. */
export function formatSats(amount: number): string {
  return amount.toLocaleString();
}

/** Format a percentage (0-1) to display. */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Capitalize first letter. */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Format a query status for display. */
export function formatStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
