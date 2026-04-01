import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getMcpQueryBackend } from "./mcp-query-backend";
import { isNostrEnabled } from "./nostr/client";
import { isCashuEnabled } from "./cashu/wallet";
import type { QueryInput, QueryResult } from "../application/query-service";
import type { RequesterMeta } from "../domain/types";
import { VERIFICATION_FACTORS } from "../domain/types";

function buildRequesterMeta(): RequesterMeta {
  return {
    requester_type: "agent",
    client_name: process.env.REMOTE_QUERY_API_BASE_URL ? "mcp-remote" : "mcp",
  };
}

export async function startMcpServer() {
  const server = new McpServer({
    name: "anchr",
    version: "0.3.0",
  });
  const backend = getMcpQueryBackend();

  server.tool(
    "create_query",
    "Request cryptographically verified data. Two modes:\n" +
    "1. Web data (TLSNotary): Prove what an HTTPS API returned. Set verification_requirements=['tlsn'] and provide target_url. " +
    "An auto-worker fetches the URL via MPC-TLS and returns a cryptographic proof tied to the server's TLS certificate.\n" +
    "2. Real-world observation (C2PA): Request a human to photograph or observe something. " +
    "The worker submits C2PA-verified media with GPS proof.\n" +
    (isNostrEnabled() ? "Query is broadcast via Nostr relays. " : "") +
    (isCashuEnabled() ? "Bounty paid via Cashu ecash (anonymous). " : "") +
    "Returns a query_id — poll with get_query_status.",
    {
      description: z.string().describe("What to verify, e.g. 'BTC price from CoinGecko' or '渋谷スクランブル交差点の混雑状況'"),
      location_hint: z.string().optional().describe("Region or location hint for real-world queries (e.g. '渋谷')"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Query time limit in seconds (default 600)"),
      oracle_ids: z.array(z.string()).optional().describe("Acceptable oracle IDs for verification. Omit to accept any."),
      verification_requirements: z.array(z.enum(VERIFICATION_FACTORS)).optional().describe("Verification factors: ['tlsn'] for web data, ['gps','ai_check'] for photos (default)."),
      target_url: z.string().url().optional().describe("HTTPS URL to prove via TLSNotary (e.g. 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'). Required when verification_requirements includes 'tlsn'."),
      target_method: z.enum(["GET", "POST"]).optional().describe("HTTP method for TLSNotary request (default GET)."),
      conditions: z.array(z.object({
        type: z.enum(["contains", "regex", "jsonpath"]).describe("Condition type"),
        expression: z.string().describe("Expression to evaluate (e.g. JSONPath 'bitcoin.usd', regex pattern, or substring)"),
        expected: z.string().optional().describe("Expected value (for jsonpath/regex)"),
        description: z.string().optional().describe("Human-readable description of what this checks"),
      })).optional().describe("Conditions to verify against the proven response body."),
    },
    async ({ description, location_hint, ttl_seconds, oracle_ids, verification_requirements, target_url, target_method, conditions }) => {
      const input: QueryInput = {
        description,
        location_hint,
        verification_requirements,
        tlsn_requirements: target_url ? {
          target_url,
          method: target_method,
          conditions,
        } : undefined,
      };
      const payload = await backend.createQuery(input, ttl_seconds ?? 600, buildRequesterMeta(), oracle_ids);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "get_query_status",
    "Poll the status of an Anchr query. Returns status and verified result if available.",
    {
      query_id: z.string().describe("Query ID returned from create_query"),
    },
    async ({ query_id }) => {
      const payload = await backend.getQueryStatus(query_id);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "cancel_query",
    "Cancel a pending Anchr query.",
    {
      query_id: z.string().describe("Query ID to cancel"),
    },
    async ({ query_id }) => {
      const payload = await backend.cancelQuery(query_id);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "list_available_queries",
    "List currently available Anchr queries waiting for a reporter.",
    {},
    async () => {
      const payload = await backend.listAvailableQueries();
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "submit_query_result",
    "Submit a result for a pending Anchr query. Normally reporters use the worker app, but this tool allows direct submission for testing.",
    {
      query_id: z.string().describe("Query ID to submit against"),
      result: z.record(z.string(), z.unknown()).describe("Result object with attachments and optional notes"),
      oracle_id: z.string().optional().describe("Oracle ID to use for verification. Omit to use default."),
    },
    async ({ query_id, result, oracle_id }) => {
      const payload = await backend.submitQueryResult(query_id, result as unknown as QueryResult, oracle_id);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "get_query_attachment",
    "Retrieve URL and metadata for an attachment on a completed query. EXIF data has been stripped for privacy.",
    {
      query_id: z.string().describe("Query ID to inspect"),
      attachment_index: z.number().int().min(0).optional().describe("Zero-based attachment index. Defaults to 0."),
    },
    async ({ query_id, attachment_index }) => {
      const payload = await backend.getQueryAttachment(query_id, attachment_index ?? 0);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "get_query_attachment_preview",
    "Retrieve a resized preview image for a completed query.",
    {
      query_id: z.string().describe("Query ID to inspect"),
      attachment_index: z.number().int().min(0).optional().describe("Zero-based attachment index. Defaults to 0."),
      max_dimension: z.number().int().min(64).max(2048).optional().describe("Maximum width or height of the preview image. Defaults to PREVIEW_MAX_DIMENSION."),
    },
    async ({ query_id, attachment_index, max_dimension }) => {
      const preview = await backend.getQueryAttachmentPreview(query_id, attachment_index ?? 0, max_dimension);
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
        {
          type: "text",
          text: JSON.stringify(preview.payload, null, 2),
        },
      ];

      if (preview.image) {
        content.push({
          type: "image",
          data: preview.image.data,
          mimeType: preview.image.mimeType,
        });
      }

      return { content };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-server] Connected via stdio");
}
