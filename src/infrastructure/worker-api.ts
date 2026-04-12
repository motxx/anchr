import { timingSafeEqual, createHash } from "node:crypto";
import { join } from "node:path";
import { spawn, fileExists, fileLastModified, moduleDir } from "../runtime/mod.ts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, MiddlewareHandler } from "hono";
import { getRuntimeConfig } from "./config";
import { listOracles } from "./oracle";
import type { OracleRegistry } from "./oracle/registry";
import type { PreimageStore } from "./cashu/preimage-store";
import {
  defaultService as defaultQueryService,
  type QueryService,
} from "../application/query-service";
import {
  registerQueryRoutes,
  registerAttachmentRoutes,
  registerHtlcRoutes,
  registerLogRoutes,
} from "./worker-api-routes";
import { registerMarketplaceRoutes } from "./marketplace/marketplace-routes";
import { createListingStore, type ListingStore } from "./marketplace/listing-store";

export interface WorkerApiDeps {
  queryService?: QueryService;
  oracleRegistry?: OracleRegistry;
  preimageStore?: PreimageStore;
  listingStore?: ListingStore;
}

// --- Auth Middleware ---

// API key comparison — SHA-256 is used to normalize lengths for timingSafeEqual,
// NOT as a password hash. API keys are high-entropy random tokens, not passwords.
function safeCompare(a: string, b: string): boolean { // codeql[js/insufficient-password-hash]
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB) && a.length === b.length;
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
    if (process.env.NODE_ENV === "production") {
      return c.json({ error: "Server misconfigured: no API keys set" }, 503);
    }
    console.error("[security] WARNING: No API keys configured — write endpoints are unauthenticated");
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

// --- CSS Build ---

async function buildCssIfNeeded(cssIn: string, cssOut: string, label: string) {
  if (await fileExists(cssOut)) {
    const outStat = await fileLastModified(cssOut);
    const inStat = await fileLastModified(cssIn);
    if (outStat >= inStat) {
      return;
    }
  }

  const proc = spawn(["npx", "tailwindcss", "-i", cssIn, "-o", cssOut], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    console.error(`[css-build:${label}] Failed:`, await new Response(proc.stderr).text());
  }
}

export async function prepareWorkerApiAssets() {
  const dir = moduleDir(import.meta);
  await Promise.all([
    buildCssIfNeeded(join(dir, "../ui/globals.css"), join(dir, "../ui/generated.css"), "worker"),
    buildCssIfNeeded(join(dir, "../ui/requester/globals.css"), join(dir, "../ui/requester/generated.css"), "requester"),
    buildCssIfNeeded(join(dir, "../ui/dashboard/globals.css"), join(dir, "../ui/dashboard/generated.css"), "dashboard"),
  ]);
}

// --- App ---

export function buildWorkerApiApp(deps?: WorkerApiDeps) {
  const svc = deps?.queryService ?? defaultQueryService;
  const pStore = deps?.preimageStore;
  const doListOracles = deps?.oracleRegistry ? () => deps.oracleRegistry!.list() : listOracles;

  const app = new Hono();

  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin && process.env.NODE_ENV === "production") {
    console.error("[security] WARNING: CORS_ORIGIN not set in production — defaulting to same-origin only");
  }
  app.use("*", cors({
    origin: corsOrigin || (process.env.NODE_ENV === "production" ? "" : "*"),
  }));

  // --- Rate limiting for write endpoints ---
  const RATE_WINDOW_MS = 60_000;
  const RATE_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX) || 60;
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();

  const rateLimit: MiddlewareHandler = async (c, next) => {
    const xff = c.req.header("x-forwarded-for");
    const xffParts = xff?.split(",").map((s) => s.trim()).filter(Boolean);
    const ip = xffParts?.length ? xffParts[xffParts.length - 1]! : "unknown";
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

  // --- Marketplace routes ---
  const listingStore = deps?.listingStore ?? createListingStore();
  registerMarketplaceRoutes(app, { listingStore, preimageStore: pStore, writeAuth, rateLimit });

  return app;
}
