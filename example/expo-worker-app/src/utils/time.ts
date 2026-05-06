export function timeLeft(expiresAt: number): string {
  const s = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  if (s === 0) return "expired";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export function isExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt;
}

export function isUrgent(expiresAt: number): boolean {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) < 60;
}

export function isCritical(expiresAt: number): boolean {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) < 10;
}

/** Format timestamp as "M/D HH:MM". */
export function formatShortTime(ts: number): string {
  const d = new Date(ts);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hours}:${minutes}`;
}

const TERMINAL_STATUSES = new Set(["approved", "rejected", "expired"]);

/** Whether a query status is terminal (no further updates expected). */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}
