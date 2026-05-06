import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, MiddlewareHandler } from "hono";
import { getRuntimeConfig } from "./config.ts";
import { listOracles } from "./oracle-client/index.ts";
import type { OracleRegistry } from "./oracle-client/registry.ts";
import type { PreimageStore } from "@anchr/core-cashu/preimage-store";
import type { QueryService } from "../application/query-service.ts";
import {
  registerQueryRoutes,
  registerAttachmentRoutes,
  registerHtlcRoutes,
  registerLogRoutes,
} from "./worker-api-routes.ts";

import { getLogger } from "@anchr/core-runtime/logger";
const log = getLogger(["anchr", "security"]);

/**
 * Hook signature for example apps that extend the core HTTP surface with
 * their own routes (e.g. data-marketplace). Receives the shared auth /
 * rate-limit middleware and the preimage store so extensions inherit the
 * host's security posture without re-implementing it.
 */
export interface WorkerApiExtraRouteContext {
  preimageStore?: PreimageStore;
  writeAuth: MiddlewareHandler;
  rateLimit: MiddlewareHandler;
}

export interface WorkerApiDeps {
  queryService: QueryService;
  oracleRegistry?: OracleRegistry;
  preimageStore?: PreimageStore;
  /** Called after core routes are registered. Use to layer example-specific routes on top. */
  extraRoutes?: (app: Hono, ctx: WorkerApiExtraRouteContext) => void;
}

// --- Auth Middleware ---

// Timing-safe API key comparison following Cloudflare's recommended pattern.
// When lengths differ, compare the input against itself to maintain constant time
// without leaking the secret's length via response timing.
// https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/
const encoder = new TextEncoder();
function safeCompare(a: string, b: string): boolean {
  const userValue = encoder.encode(a);
  const secretValue = encoder.encode(b);
  const lengthsMatch = userValue.byteLength === secretValue.byteLength;
  return lengthsMatch
    ? timingSafeEqual(userValue, secretValue)
    : !timingSafeEqual(userValue, userValue);
}

function extractApiKey(c: Context): string | null {
  const authorization = c.req.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token || null;
  }
  return c.req.header("x-api-key")?.trim() || null;
}

const writeAuth: MiddlewareHandler = async (c, next) => {
  const { httpApiKeys } = getRuntimeConfig();
  if (httpApiKeys.length === 0) {
    if (Deno.env.get("NODE_ENV") === "production") {
      return c.json({ error: "Server misconfigured: no API keys set" }, 503);
    }
    log.error("WARNING: No API keys configured — write endpoints are unauthenticated");
    return next();
  }

  const supplied = extractApiKey(c);
  if (supplied && httpApiKeys.some((key) => safeCompare(supplied, key))) return next();

  return c.json(
    { error: "Unauthorized", hint: "Set Authorization: Bearer <key> or X-API-Key: <key> to access write endpoints." },
    401,
    { "www-authenticate": "Bearer" },
  );
};

// --- App ---

export function buildWorkerApiApp(deps: WorkerApiDeps) {
  const svc = deps.queryService;
  const pStore = deps.preimageStore;
  const doListOracles = deps.oracleRegistry ? () => deps.oracleRegistry!.list() : listOracles;

  const app = new Hono();

  const corsOrigin = Deno.env.get("CORS_ORIGIN");
  if (!corsOrigin && Deno.env.get("NODE_ENV") === "production") {
    log.error("WARNING: CORS_ORIGIN not set in production — defaulting to same-origin only");
  }
  app.use("*", cors({
    origin: corsOrigin || (Deno.env.get("NODE_ENV") === "production" ? "" : "*"),
  }));

  // --- Rate limiting for write endpoints ---
  const RATE_WINDOW_MS = 60_000;
  const RATE_MAX_REQUESTS = Number(Deno.env.get("RATE_LIMIT_MAX")) || 60;
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();

  // Rate limiting: use Fly-Client-IP (Fly.io) > X-Real-IP (nginx) > socket address.
  // X-Forwarded-For is NOT used because it is attacker-controlled without a trusted proxy.
  // https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/
  const rateLimit: MiddlewareHandler = async (c, next) => {
    const ip = c.req.header("fly-client-ip")
      ?? c.req.header("x-real-ip")
      ?? (c.env?.remoteAddr as { hostname?: string })?.hostname
      ?? "unknown";
    const now = Date.now();
    let bucket = rateBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      rateBuckets.set(ip, bucket);
    }
    bucket.count++;
    if (bucket.count > RATE_MAX_REQUESTS) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }
    if (rateBuckets.size > 1000) {
      for (const [k, v] of rateBuckets) {
        if (now > v.resetAt) rateBuckets.delete(k);
      }
    }
    return next();
  };

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/oracles", (c) => c.json(doListOracles()));

  const routeCtx = { svc, pStore, doListOracles, writeAuth, rateLimit };
  registerQueryRoutes(app, routeCtx);
  registerAttachmentRoutes(app, routeCtx);
  registerHtlcRoutes(app, routeCtx);
  registerLogRoutes(app, writeAuth);

  deps.extraRoutes?.(app, { preimageStore: pStore, writeAuth, rateLimit });

  return app;
}
