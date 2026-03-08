import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildAttachmentAbsoluteUrl,
  buildAttachmentHandle,
  materializeQueryResult,
  renderStoredAttachmentPreview,
  statStoredAttachment,
} from "./attachments";
import { getRuntimeConfig } from "./config";
import {
  cancelQuery,
  createQuery,
  getQuery,
  listOpenQueries,
  submitQueryResult,
  type Query,
  type QueryInput,
  type QueryResult,
} from "./query-service";
import type { AttachmentRef } from "./types";

const runtimeConfig = getRuntimeConfig();
const referenceBaseUrl = `http://localhost:${runtimeConfig.referenceAppPort}`;

function buildCreatedQueryPayload(query: {
  id: string;
  type: string;
  status: string;
  challenge_nonce: string;
  challenge_rule: string;
  expires_at: number;
  requester_meta?: Query["requester_meta"];
}) {
  return {
    query_id: query.id,
    status: query.status,
    type: query.type,
    challenge_nonce: query.challenge_nonce,
    challenge_rule: query.challenge_rule,
    expires_at: new Date(query.expires_at).toISOString(),
    requester_meta: query.requester_meta ?? null,
    reference_app_url: `${referenceBaseUrl}/queries/${query.id}`,
    query_api_url: `${referenceBaseUrl}/queries/${query.id}`,
  };
}

function buildQueryStatusPayload(query: Query) {
  const result = query.result ? materializeQueryResult(query.result, referenceBaseUrl) : null;
  const payload = {
    query_id: query.id,
    type: query.type,
    status: query.status,
    requester_meta: query.requester_meta ?? null,
    payment_status: query.payment_status,
    expires_in_seconds: Math.max(0, Math.floor((query.expires_at - Date.now()) / 1000)),
    result,
    verification: query.verification ?? null,
    submission_meta: query.submission_meta ?? null,
  };

  if (query.type === "photo_proof") {
    const attachments = query.result?.type === "photo_proof"
      ? query.result.attachments.map((attachment, index) => buildAttachmentHandle(query.id, index, attachment, referenceBaseUrl))
      : [];
    const attachmentCount = attachments.length;
    return {
      ...payload,
      attachment_count: attachmentCount,
      attachments,
      attachment_access: attachmentCount > 0
        ? "Use get_query_attachment for URLs/paths, or get_query_attachment_preview for a resized preview image through MCP."
        : null,
    };
  }

  return payload;
}

function getPhotoProofAttachmentRefs(query: Query): AttachmentRef[] | null {
  if (query.type !== "photo_proof" || query.result?.type !== "photo_proof") {
    return null;
  }

  return query.result.attachments;
}

export async function startMcpServer() {
  const server = new McpServer({
    name: "human-calling-mcp",
    version: "0.1.0",
  });

  // Tool: request_photo_proof
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
      const query = createQuery(params, {
        ttlSeconds: ttl_seconds ?? 600,
        requesterMeta: {
          requester_type: "agent",
          client_name: "mcp",
        },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(buildCreatedQueryPayload(query), null, 2),
          },
        ],
      };
    },
  );

  // Tool: request_store_status
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
      const query = createQuery(params, {
        ttlSeconds: ttl_seconds ?? 600,
        requesterMeta: {
          requester_type: "agent",
          client_name: "mcp",
        },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(buildCreatedQueryPayload(query), null, 2),
          },
        ],
      };
    },
  );

  // Tool: request_webpage_field
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
      const query = createQuery(params, {
        ttlSeconds: ttl_seconds ?? 600,
        requesterMeta: {
          requester_type: "agent",
          client_name: "mcp",
        },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(buildCreatedQueryPayload(query), null, 2),
          },
        ],
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
      const query = getQuery(query_id);
      if (!query) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Query not found" }) }] };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(buildQueryStatusPayload(query), null, 2),
          },
        ],
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
      const outcome = cancelQuery(query_id);
      return { content: [{ type: "text", text: JSON.stringify(outcome) }] };
    },
  );

  server.tool(
    "list_available_queries",
    "List currently available live queries. Useful for debugging or building a reference worker app.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            listOpenQueries().map((query) => ({
              query_id: query.id,
              type: query.type,
              challenge_rule: query.challenge_rule,
              expires_in_seconds: Math.max(0, Math.floor((query.expires_at - Date.now()) / 1000)),
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.tool(
    "submit_query_result",
    "Submit a result for a pending live real-world query. Normally reference apps use the HTTP API, but this tool allows direct submission for testing.",
    {
      query_id: z.string().describe("Query ID to submit against"),
      result: z.record(z.string(), z.unknown()).describe("Result object matching the query type"),
    },
    async ({ query_id, result }) => {
      const outcome = submitQueryResult(query_id, result as unknown as QueryResult, {
        executor_type: "agent",
        channel: "mcp",
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: outcome.ok,
              message: outcome.message,
              query_id: outcome.query?.id ?? null,
              verification: outcome.query?.verification,
              payment_status: outcome.query?.payment_status,
            }, null, 2),
          },
        ],
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
      const query = getQuery(query_id);
      if (!query) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Query not found" }) }] };
      }

      const attachments = getPhotoProofAttachmentRefs(query);
      if (!attachments) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Query does not have photo proof attachments" }) }] };
      }

      const index = attachment_index ?? 0;
      const attachmentRef = attachments[index];
      if (!attachmentRef) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `Attachment index ${index} not found` }) }] };
      }

      const attachmentInfo = await statStoredAttachment(attachmentRef);
      if (!attachmentInfo) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Attachment file not found" }) }] };
      }

      const absoluteUrl = attachmentInfo.absoluteUrl ?? buildAttachmentAbsoluteUrl(attachmentRef);
      const handle = buildAttachmentHandle(query.id, index, attachmentRef, referenceBaseUrl);
      const payload = {
        query_id: query.id,
        attachment_index: index,
        attachment: handle.attachment,
        access: {
          ...handle.access,
          preview_url: handle.access.preview_url ?? undefined,
          local_file_path: attachmentInfo.path ?? handle.access.local_file_path ?? undefined,
        },
        attachment_view_url: handle.access.view_url,
        attachment_meta_url: handle.access.meta_url,
        filename: attachmentInfo.filename,
        attachment_path: attachmentInfo.routePath ?? null,
        absolute_url: absoluteUrl,
        local_file_path: attachmentInfo.path ?? null,
        storage_kind: attachmentInfo.storageKind,
        mime_type: attachmentInfo.mimeType,
        size_bytes: attachmentInfo.size,
        preview_hint: "Use get_query_attachment_preview for a resized inline preview image.",
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
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
      const query = getQuery(query_id);
      if (!query) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Query not found" }) }] };
      }

      const attachments = getPhotoProofAttachmentRefs(query);
      if (!attachments) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Query does not have photo proof attachments" }) }] };
      }

      const index = attachment_index ?? 0;
      const attachmentRef = attachments[index];
      if (!attachmentRef) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `Attachment index ${index} not found` }) }] };
      }

      const attachmentInfo = await statStoredAttachment(attachmentRef);
      if (!attachmentInfo) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Attachment file not found" }) }] };
      }

      const handle = buildAttachmentHandle(query.id, index, attachmentRef, referenceBaseUrl);
      const preview = await renderStoredAttachmentPreview(attachmentRef, referenceBaseUrl, {
        maxDimension: max_dimension ?? runtimeConfig.previewMaxDimension,
      });

      if (!preview) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                query_id: query.id,
                attachment_index: index,
                attachment: handle.attachment,
                access: handle.access,
                error: "Preview could not be generated",
                hint: "Use get_query_attachment for original URLs or inspect the image in the browser.",
              }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              query_id: query.id,
              attachment_index: index,
              attachment: handle.attachment,
              access: {
                ...handle.access,
                preview_url: `${handle.access.preview_url}?max_dimension=${preview.maxDimension}`,
              },
              original_size_bytes: attachmentInfo.size,
              preview_size_bytes: preview.size,
              preview_mime_type: preview.mimeType,
              max_dimension: preview.maxDimension,
            }, null, 2),
          },
          {
            type: "image",
            data: preview.data,
            mimeType: preview.mimeType,
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-server] Connected via stdio");
}
