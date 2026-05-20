/**
 * Data Marketplace — example application with its own HTTP adapter routes and
 * MCP tools.
 *
 * Usage:
 *   deno run --allow-all example/data-marketplace/server.ts
 */

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { createQueryService } from "@anchr/bounty/flow";
import { createOracleRegistry } from "@anchr/bounty/oracle-client";
import { normalizeQueryResult } from "@anchr/bounty/attachments";
import { createPreimageStore } from "@anchr/core-cashu/preimage-store";
import { startMcpServer } from "@anchr/anchr-mcp/mcp-server";
import { createListingStore } from "./src/marketplace/listing-store.ts";
import { registerMarketplaceRoutes } from "./src/marketplace/marketplace-routes.ts";
import {
  handleMarketplaceBuyData,
  handleMarketplaceListData,
  handleMarketplaceSearchListings,
} from "./src/mcp-marketplace-handlers.ts";
import { z } from "zod";
import { getLogger } from "@anchr/core-runtime/logger";

const log = getLogger(["anchr", "data-marketplace"]);

const HTTP_PORT = Number(Deno.env.get("HTTP_API_PORT")) || 3000;
const listingStore = createListingStore();
const encoder = new TextEncoder();

function apiKeys(): string[] {
  return (Deno.env.get("HTTP_API_KEYS") ?? Deno.env.get("HTTP_API_KEY") ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function safeCompare(value: string, secret: string): boolean {
  const valueBytes = encoder.encode(value);
  const secretBytes = encoder.encode(secret);
  const lengthsMatch = valueBytes.byteLength === secretBytes.byteLength;
  return lengthsMatch
    ? timingSafeEqual(valueBytes, secretBytes)
    : !timingSafeEqual(valueBytes, valueBytes);
}

const writeAuth: MiddlewareHandler = async (c, next) => {
  const keys = apiKeys();
  if (keys.length === 0) {
    if (Deno.env.get("NODE_ENV") === "production") {
      return c.json({ error: "Server misconfigured: no API keys set" }, 503);
    }
    return next();
  }
  const supplied = c.req.header("x-api-key")?.trim() ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (supplied && keys.some((key) => safeCompare(supplied, key))) {
    return next();
  }
  return c.json({ error: "Unauthorized" }, 401);
};

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = Number(Deno.env.get("RATE_LIMIT_MAX")) || 60;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

const rateLimit: MiddlewareHandler = async (c, next) => {
  const ip = c.req.header("fly-client-ip") ??
    c.req.header("x-real-ip") ??
    (c.env?.remoteAddr as { hostname?: string })?.hostname ??
    "unknown";
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
  return next();
};

const preimageStore = createPreimageStore();
const queryService = createQueryService({
  oracleRegistry: createOracleRegistry(),
  preimageStore,
  normalizeResult: normalizeQueryResult,
});
const capabilities = {
  cashu: Boolean(Deno.env.get("CASHU_MINT_URL")?.trim()),
  nostr: Boolean(Deno.env.get("NOSTR_RELAYS")?.trim()),
};
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
registerMarketplaceRoutes(app, {
  listingStore,
  preimageStore,
  writeAuth,
  rateLimit,
});

if (Deno.env.get("MCP_STDIO") === "1") {
  await startMcpServer({
    queryService,
    capabilities,
    extraTools: (server, backend) => {
      server.tool(
        "marketplace_list_data",
        "List available verified data listings on the Anchr marketplace. " +
          "Each listing provides TLSNotary-proven API data that can be purchased with Cashu ecash.",
        {
          active_only: z.boolean().optional().describe(
            "Only show active listings (default true)",
          ),
        },
        async (args: { active_only?: boolean }) => {
          return handleMarketplaceListData(backend, args.active_only ?? true);
        },
      );

      server.tool(
        "marketplace_buy_data",
        "Purchase verified data from the Anchr marketplace. " +
          "Pays with Cashu ecash token (X-Cashu direct mode). " +
          "Returns the data along with TLSNotary proof of authenticity.",
        {
          listing_id: z.string().describe("Listing ID to purchase"),
          cashu_token: z.string().describe("Cashu ecash token for payment"),
        },
        async (args: { listing_id: string; cashu_token: string }) => {
          return handleMarketplaceBuyData(
            backend,
            args.listing_id,
            args.cashu_token,
          );
        },
      );

      server.tool(
        "marketplace_search_listings",
        "Search marketplace listings by keyword in name or description.",
        {
          query: z.string().describe("Search keyword"),
        },
        async (args: { query: string }) => {
          return handleMarketplaceSearchListings(backend, args.query);
        },
      );
    },
  });
}

log.info(`Anchr + data-marketplace listening on :${HTTP_PORT}`);
Deno.serve({ port: HTTP_PORT }, app.fetch);
