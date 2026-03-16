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
