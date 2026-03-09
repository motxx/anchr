import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getMcpQueryBackend } from "./mcp-query-backend";
import type { QueryInput, QueryResult, RequesterMeta } from "./query-service";

function buildRequesterMeta(): RequesterMeta {
  return {
    requester_type: "agent",
    client_name: process.env.REMOTE_QUERY_API_BASE_URL ? "mcp-remote" : "mcp",
  };
}

export async function startMcpServer() {
  const server = new McpServer({
    name: "human-calling-mcp",
    version: "0.1.0",
  });
  const backend = getMcpQueryBackend();

  server.tool(
    "request_photo_proof",
    "Ask a human to photograph a specific target. The human must include a one-time nonce in the photo or text answer. Returns a query_id for polling.",
    {
      target: z.string().describe("What should be photographed, e.g. '○○店の営業時間表示'"),
      location_hint: z.string().optional().describe("Optional hint of the location"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Query time limit in seconds (default 600)"),
    },
    async ({ target, location_hint, ttl_seconds }) => {
      const params: QueryInput = { type: "photo_proof", target, location_hint };
      const payload = await backend.createQuery(params, ttl_seconds ?? 600, buildRequesterMeta());
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "request_store_status",
    "Ask a human to check if a store is currently open or closed. Returns a live query. The human must include a nonce in their notes.",
    {
      store_name: z.string().describe("Store name, e.g. 'セブンイレブン渋谷店'"),
      location_hint: z.string().optional().describe("Optional location hint"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Query time limit in seconds (default 600)"),
    },
    async ({ store_name, location_hint, ttl_seconds }) => {
      const params: QueryInput = { type: "store_status", store_name, location_hint };
      const payload = await backend.createQuery(params, ttl_seconds ?? 600, buildRequesterMeta());
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "request_webpage_field",
    "Ask a human to extract a specific field from a webpage and provide nearby proof text. Returns a live query.",
    {
      url: z.string().url().describe("URL of the webpage"),
      field: z.string().describe("What to extract, e.g. '税込価格'"),
      anchor_word: z.string().describe("A word near the target field to serve as proof of reading the page"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Query time limit in seconds (default 600)"),
    },
    async ({ url, field, anchor_word, ttl_seconds }) => {
      const params: QueryInput = { type: "webpage_field", url, field, anchor_word };
      const payload = await backend.createQuery(params, ttl_seconds ?? 600, buildRequesterMeta());
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "get_query_status",
    "Poll the status of a live real-world query. Returns status and result if available.",
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
    "Cancel a pending live real-world query.",
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
    "List currently available live queries. Useful for debugging or building a reference worker app.",
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
    "Submit a result for a pending live real-world query. Normally reference apps use the HTTP API, but this tool allows direct submission for testing.",
    {
      query_id: z.string().describe("Query ID to submit against"),
      result: z.record(z.string(), z.unknown()).describe("Result object matching the query type"),
    },
    async ({ query_id, result }) => {
      const payload = await backend.submitQueryResult(query_id, result as unknown as QueryResult);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    "get_query_attachment",
    "Retrieve URL and metadata for an attachment on a completed photo proof query. This tool does not inline image bytes.",
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
    "Retrieve a resized preview image for a completed photo proof query. This is safer for Claude Desktop than inlining the original image.",
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
