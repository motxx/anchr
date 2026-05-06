/**
 * Data Marketplace — example application built on the Anchr host.
 *
 * Calls `composeHost({extraRoutes})` to get the standard worker-api app
 * extended with marketplace-specific routes (`/marketplace/*`) for
 * x402-style verified-data listings, plus the MCP tools that drive the
 * same listings via tool calls.
 *
 * Usage:
 *   deno run --allow-all example/data-marketplace/server.ts
 */

import { composeHost } from "@anchr/bounty";
import { startMcpServer } from "@anchr/bounty/mcp-server";
import { createListingStore } from "./src/marketplace/listing-store.ts";
import { registerMarketplaceRoutes } from "./src/marketplace/marketplace-routes.ts";
import {
  handleMarketplaceListData,
  handleMarketplaceBuyData,
  handleMarketplaceSearchListings,
} from "./src/mcp-marketplace-handlers.ts";
import { z } from "zod";
import { getLogger } from "@anchr/core-runtime/logger";

const log = getLogger(["anchr", "data-marketplace"]);

const HTTP_PORT = Number(Deno.env.get("HTTP_API_PORT")) || 3000;
const listingStore = createListingStore();

const { queryService, app, capabilities } = composeHost({
  extraRoutes: (app, ctx) => {
    registerMarketplaceRoutes(app, {
      listingStore,
      preimageStore: ctx.preimageStore,
      writeAuth: ctx.writeAuth,
      rateLimit: ctx.rateLimit,
    });
  },
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
          active_only: z.boolean().optional().describe("Only show active listings (default true)"),
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
          return handleMarketplaceBuyData(backend, args.listing_id, args.cashu_token);
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
