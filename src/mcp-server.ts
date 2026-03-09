import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getMcpQueryBackend } from "./mcp-query-backend";
import { isNostrEnabled } from "./nostr/client";
import { isCashuEnabled } from "./cashu/wallet";
import type { QueryInput, QueryResult, RequesterMeta } from "./query-service";

function buildRequesterMeta(): RequesterMeta {
  return {
    requester_type: "agent",
    client_name: process.env.REMOTE_QUERY_API_BASE_URL ? "mcp-remote" : "mcp",
  };
}

export async function startMcpServer() {
  const server = new McpServer({
    name: "anchr",
    version: "0.2.0",
  });
  const backend = getMcpQueryBackend();

  server.tool(
    "request_photo_proof",
    "Request an anonymous human to photograph a real-world target and report what they see. " +
    "The reporter must include a one-time nonce to prove freshness. " +
    "Use this to verify ground truth that cannot be determined from the internet alone. " +
    "Photos are EXIF-stripped for reporter privacy. " +
    (isNostrEnabled() ? "Query is broadcast via Nostr relays. " : "") +
    (isCashuEnabled() ? "Bounty paid via Cashu ecash (anonymous). " : "") +
    "Returns a query_id for polling.",
    {
      target: z.string().describe("What should be photographed or reported on, e.g. 'テヘラン市街の現在の様子' or '天安門広場の掲示物'"),
      location_hint: z.string().optional().describe("Region or location hint (e.g. 'IR', 'CN', '渋谷')"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Query time limit in seconds (default 600)"),
      oracle_ids: z.array(z.string()).optional().describe("Acceptable oracle IDs for verification. Omit to accept any."),
    },
    async ({ target, location_hint, ttl_seconds, oracle_ids }) => {
      const params: QueryInput = { type: "photo_proof", target, location_hint };
      const payload = await backend.createQuery(params, ttl_seconds ?? 600, buildRequesterMeta(), oracle_ids);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "request_store_status",
    "Request an anonymous human to verify if a place is currently open or closed. " +
    "The reporter must include a nonce in their notes to prove freshness.",
    {
      store_name: z.string().describe("Place or store name, e.g. 'セブンイレブン渋谷店'"),
      location_hint: z.string().optional().describe("Optional location hint"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Query time limit in seconds (default 600)"),
      oracle_ids: z.array(z.string()).optional().describe("Acceptable oracle IDs for verification. Omit to accept any."),
    },
    async ({ store_name, location_hint, ttl_seconds, oracle_ids }) => {
      const params: QueryInput = { type: "store_status", store_name, location_hint };
      const payload = await backend.createQuery(params, ttl_seconds ?? 600, buildRequesterMeta(), oracle_ids);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "request_webpage_field",
    "Request a human to extract a specific field from a webpage and provide nearby proof text. " +
    "Useful for verifying censorship — is this page accessible from a given region?",
    {
      url: z.string().url().describe("URL of the webpage"),
      field: z.string().describe("What to extract, e.g. '税込価格' or 'blocked status'"),
      anchor_word: z.string().describe("A word near the target field to serve as proof of reading the page"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Query time limit in seconds (default 600)"),
      oracle_ids: z.array(z.string()).optional().describe("Acceptable oracle IDs for verification. Omit to accept any."),
    },
    async ({ url, field, anchor_word, ttl_seconds, oracle_ids }) => {
      const params: QueryInput = { type: "webpage_field", url, field, anchor_word };
      const payload = await backend.createQuery(params, ttl_seconds ?? 600, buildRequesterMeta(), oracle_ids);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "get_query_status",
    "Poll the status of a ground truth query. Returns status and verified result if available.",
    {
      query_id: z.string().describe("Query ID returned from a request_* tool"),
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
    "Cancel a pending ground truth query.",
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
    "List currently available ground truth queries waiting for a reporter.",
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
    "Submit a result for a pending ground truth query. Normally reporters use the worker app, but this tool allows direct submission for testing.",
    {
      query_id: z.string().describe("Query ID to submit against"),
      result: z.record(z.string(), z.unknown()).describe("Result object matching the query type"),
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
    "Retrieve URL and metadata for an attachment on a completed photo proof query. EXIF data has been stripped for privacy.",
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
    "Retrieve a resized preview image for a completed photo proof query.",
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
