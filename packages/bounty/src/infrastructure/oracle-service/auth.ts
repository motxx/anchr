import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const encoder = new TextEncoder();

/**
 * Timing-safe API-key comparison. When lengths differ we still spend a
 * constant-time comparison against the input itself — this prevents
 * leaking the secret's length via response timing.
 * https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/
 */
export function safeCompare(a: string, b: string): boolean {
  const userValue = encoder.encode(a);
  const secretValue = encoder.encode(b);
  const lengthsMatch = userValue.byteLength === secretValue.byteLength;
  return lengthsMatch
    ? timingSafeEqual(userValue, secretValue)
    : !timingSafeEqual(userValue, userValue);
}

/** Build an auth middleware that no-ops when no apiKey is configured. */
export function buildAuthMiddleware(apiKey?: string): MiddlewareHandler {
  return async (c, next) => {
    if (!apiKey) return next();
    const auth = c.req.header("authorization");
    const key = c.req.header("x-api-key");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : key;
    if (!token || !safeCompare(token, apiKey)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}
