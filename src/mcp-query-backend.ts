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
} from "./query-service";
import type { AttachmentHandle, AttachmentRef, Query, QueryInput, QueryResult, RequesterMeta } from "./types";

const runtimeConfig = getRuntimeConfig();
const localBaseUrl = `http://localhost:${runtimeConfig.referenceAppPort}`;

// --- Shared types for MCP tool responses ---

interface McpQueryBackend {
  createQuery(input: QueryInput, ttlSeconds: number, requesterMeta: RequesterMeta, oracleIds?: string[]): Promise<unknown>;
  getQueryStatus(queryId: string): Promise<unknown>;
  listAvailableQueries(): Promise<unknown>;
  cancelQuery(queryId: string): Promise<unknown>;
  submitQueryResult(queryId: string, result: QueryResult, oracleId?: string): Promise<unknown>;
  getQueryAttachment(queryId: string, attachmentIndex: number): Promise<unknown>;
  getQueryAttachmentPreview(
    queryId: string,
    attachmentIndex: number,
    maxDimension?: number,
  ): Promise<{ payload: unknown; image?: { data: string; mimeType: string } }>;
}

// --- Shared helpers ---

function getPhotoAttachments(query: Query): AttachmentRef[] | null {
  if (query.result?.type === "photo_proof") return query.result.attachments;
  return null;
}

function buildCreatedPayload(query: Query, baseUrl: string) {
  return {
    query_id: query.id,
    type: query.type,
    status: query.status,
    challenge_nonce: query.challenge_nonce,
    challenge_rule: query.challenge_rule,
    expires_at: new Date(query.expires_at).toISOString(),
    requester_meta: query.requester_meta ?? null,
    reference_app_url: `${baseUrl}/queries/${query.id}`,
    query_api_url: `${baseUrl}/queries/${query.id}`,
  };
}

function buildStatusPayload(query: Query, baseUrl: string) {
  const result = query.result ? materializeQueryResult(query.result, baseUrl) : null;
  const payload: Record<string, unknown> = {
    query_id: query.id,
    type: query.type,
    status: query.status,
    requester_meta: query.requester_meta ?? null,
    oracle_id: query.assigned_oracle_id ?? null,
    payment_status: query.payment_status,
    expires_in_seconds: Math.max(0, Math.floor((query.expires_at - Date.now()) / 1000)),
    result,
    verification: query.verification ?? null,
    submission_meta: query.submission_meta ?? null,
  };

  if (query.type === "photo_proof" || (query.type === "store_status" && result?.type === "store_status")) {
    const attachments = result?.type === "photo_proof"
      ? result.attachments.map((att: AttachmentRef, i: number) => buildAttachmentHandle(query.id, i, att, baseUrl))
      : [];
    payload.attachment_count = attachments.length;
    payload.attachments = attachments;
    payload.attachment_access = attachments.length > 0
      ? "Use get_query_attachment for URLs/paths, or get_query_attachment_preview for a resized preview image through MCP."
      : null;
  }

  return payload;
}

async function buildAttachmentPayload(query: Query, ref: AttachmentRef, index: number, baseUrl: string) {
  const stat = await statStoredAttachment(ref, baseUrl);
  const handle = buildAttachmentHandle(query.id, index, ref, baseUrl);
  return {
    query_id: query.id,
    attachment_index: index,
    attachment: handle.attachment,
    access: {
      ...handle.access,
      preview_url: handle.access.preview_url ?? undefined,
      local_file_path: stat?.path ?? handle.access.local_file_path ?? undefined,
    },
    filename: stat?.filename ?? handle.attachment.filename ?? null,
    absolute_url: stat?.absoluteUrl ?? buildAttachmentAbsoluteUrl(ref, baseUrl),
    local_file_path: stat?.path ?? null,
    storage_kind: stat?.storageKind ?? handle.attachment.storage_kind,
    mime_type: stat?.mimeType ?? handle.attachment.mime_type,
    size_bytes: stat?.size ?? handle.attachment.size_bytes ?? null,
    preview_hint: "Use get_query_attachment_preview for a resized inline preview image.",
  };
}

async function buildPreviewPayload(
  query: Query,
  ref: AttachmentRef,
  index: number,
  baseUrl: string,
  maxDimension?: number,
): Promise<{ payload: unknown; image?: { data: string; mimeType: string } }> {
  const handle = buildAttachmentHandle(query.id, index, ref, baseUrl);
  const stat = await statStoredAttachment(ref, baseUrl);
  if (!stat) {
    return { payload: { query_id: query.id, attachment_index: index, attachment: handle.attachment, access: handle.access, error: "Attachment file not found" } };
  }

  const preview = await renderStoredAttachmentPreview(ref, baseUrl, {
    maxDimension: maxDimension ?? runtimeConfig.previewMaxDimension,
  });

  if (!preview) {
    return { payload: { query_id: query.id, attachment_index: index, attachment: handle.attachment, access: handle.access, error: "Preview could not be generated", hint: "Use get_query_attachment for original URLs or inspect the image in the browser." } };
  }

  return {
    payload: {
      query_id: query.id,
      attachment_index: index,
      attachment: handle.attachment,
      access: { ...handle.access, preview_url: `${handle.access.preview_url}?max_dimension=${preview.maxDimension}` },
      original_size_bytes: stat.size,
      preview_size_bytes: preview.size,
      preview_mime_type: preview.mimeType,
      max_dimension: preview.maxDimension,
    },
    image: { data: preview.data, mimeType: preview.mimeType },
  };
}

function errorPayload(queryId: string, index: number, message: string) {
  return { payload: { query_id: queryId, attachment_index: index, attachment: {} as AttachmentHandle["attachment"], access: {} as AttachmentHandle["access"], error: message } };
}

// --- Default backend (in-memory + relay sync) ---

function createDefaultBackend(): McpQueryBackend {
  return {
    async createQuery(input, ttlSeconds, requesterMeta, oracleIds) {
      const query = createQuery(input, { ttlSeconds, requesterMeta, oracleIds });
      return buildCreatedPayload(query, localBaseUrl);
    },
    async getQueryStatus(queryId) {
      const query = getQuery(queryId);
      return query ? buildStatusPayload(query, localBaseUrl) : { error: "Query not found" };
    },
    async listAvailableQueries() {
      return listOpenQueries().map((q) => ({
        query_id: q.id,
        type: q.type,
        challenge_rule: q.challenge_rule,
        expires_in_seconds: Math.max(0, Math.floor((q.expires_at - Date.now()) / 1000)),
      }));
    },
    async cancelQuery(queryId) {
      return cancelQuery(queryId);
    },
    async submitQueryResult(queryId, result, oracleId) {
      const outcome = await submitQueryResult(queryId, result, { executor_type: "agent", channel: "mcp" }, oracleId);
      return {
        ok: outcome.ok,
        message: outcome.message,
        query_id: outcome.query?.id ?? null,
        verification: outcome.query?.verification,
        oracle_id: outcome.query?.assigned_oracle_id ?? null,
        payment_status: outcome.query?.payment_status,
      };
    },
    async getQueryAttachment(queryId, attachmentIndex) {
      const query = getQuery(queryId);
      if (!query) return { error: "Query not found" };
      const attachments = getPhotoAttachments(query);
      if (!attachments) return { error: "Query does not have photo proof attachments" };
      const ref = attachments[attachmentIndex];
      if (!ref) return { error: `Attachment index ${attachmentIndex} not found` };
      return buildAttachmentPayload(query, ref, attachmentIndex, localBaseUrl);
    },
    async getQueryAttachmentPreview(queryId, attachmentIndex, maxDimension) {
      const query = getQuery(queryId);
      if (!query) return errorPayload(queryId, attachmentIndex, "Query not found");
      const attachments = getPhotoAttachments(query);
      if (!attachments) return errorPayload(queryId, attachmentIndex, "Query does not have photo proof attachments");
      const ref = attachments[attachmentIndex];
      if (!ref) return errorPayload(queryId, attachmentIndex, `Attachment index ${attachmentIndex} not found`);
      return buildPreviewPayload(query, ref, attachmentIndex, localBaseUrl, maxDimension);
    },
  };
}

// --- Remote backend (MCP proxy to external server) ---

function createRemoteBackend(remoteBaseUrl: string, remoteApiKey: string): McpQueryBackend {
  async function fetchJson(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (remoteApiKey) headers.set("x-api-key", remoteApiKey);
    const response = await fetch(`${remoteBaseUrl}${path}`, { ...init, headers });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    return { response, json };
  }

  return {
    async createQuery(input, ttlSeconds, requesterMeta, oracleIds) {
      const { response, json } = await fetchJson("/queries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, ttl_seconds: ttlSeconds, requester: requesterMeta, oracle_ids: oracleIds }),
      });
      if (!response.ok) throw new Error(`Remote query creation failed: ${response.status} ${JSON.stringify(json)}`);
      return json;
    },
    async getQueryStatus(queryId) {
      const { response, json } = await fetchJson(`/queries/${queryId}`);
      if (response.status === 404) return { error: "Query not found" };
      if (!response.ok) throw new Error(`Remote query lookup failed: ${response.status}`);
      const data = json as Record<string, unknown>;
      const result = data.result as QueryResult | undefined;
      if (data.type === "photo_proof" && result?.type === "photo_proof") {
        const attachments = result.attachments.map((att: AttachmentRef, i: number) =>
          buildAttachmentHandle(String(data.id), i, att, remoteBaseUrl),
        );
        data.attachment_count = attachments.length;
        data.attachments = attachments;
        data.attachment_access = attachments.length > 0
          ? "Use get_query_attachment for URLs/paths, or get_query_attachment_preview for a resized preview image through MCP."
          : null;
      }
      return data;
    },
    async listAvailableQueries() {
      const { response, json } = await fetchJson("/queries");
      if (!response.ok) throw new Error(`Remote query listing failed: ${response.status}`);
      return (json as Array<Record<string, unknown>>).map((q) => ({
        query_id: String(q.id),
        type: String(q.type),
        challenge_rule: String(q.challenge_rule),
        expires_in_seconds: Number(q.expires_in_seconds ?? 0),
      }));
    },
    async cancelQuery(queryId) {
      const { json } = await fetchJson(`/queries/${queryId}/cancel`, { method: "POST" });
      return json;
    },
    async submitQueryResult(queryId, result, oracleId) {
      const { json } = await fetchJson(`/queries/${queryId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...result, oracle_id: oracleId }),
      });
      return json;
    },
    async getQueryAttachment(queryId, attachmentIndex) {
      const { response, json } = await fetchJson(`/queries/${queryId}/attachments/${attachmentIndex}/meta`);
      if (response.status === 404) return { error: "Attachment not found" };
      if (!response.ok) throw new Error(`Remote attachment lookup failed: ${response.status}`);
      return { ...(json as Record<string, unknown>), preview_hint: "Use get_query_attachment_preview for a resized inline preview image." };
    },
    async getQueryAttachmentPreview(queryId, attachmentIndex, maxDimension) {
      const meta = await this.getQueryAttachment(queryId, attachmentIndex);
      if (meta && typeof meta === "object" && "error" in meta) {
        return errorPayload(queryId, attachmentIndex, (meta as { error: string }).error);
      }
      const metaData = meta as Record<string, unknown>;
      const attachment = (metaData.attachment ?? {}) as AttachmentHandle["attachment"];
      const access = (metaData.access ?? {}) as AttachmentHandle["access"];

      const previewUrl = new URL(
        (access.preview_url as string) ?? `${remoteBaseUrl}/queries/${queryId}/attachments/${attachmentIndex}/preview`,
      );
      if (maxDimension) previewUrl.searchParams.set("max_dimension", String(maxDimension));

      const headers = new Headers();
      if (remoteApiKey) headers.set("x-api-key", remoteApiKey);
      const response = await fetch(previewUrl, { headers });
      if (!response.ok) {
        return { payload: { query_id: queryId, attachment_index: attachmentIndex, attachment, access, error: "Preview could not be generated", hint: "Use get_query_attachment for original URLs." } };
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const mimeType = response.headers.get("content-type") ?? "image/jpeg";
      return {
        payload: {
          query_id: queryId,
          attachment_index: attachmentIndex,
          attachment,
          access: { ...access, preview_url: previewUrl.toString() },
          original_size_bytes: metaData.size_bytes ?? null,
          preview_size_bytes: bytes.length,
          preview_mime_type: mimeType,
          max_dimension: maxDimension ?? runtimeConfig.previewMaxDimension,
        },
        image: { data: bytes.toString("base64"), mimeType },
      };
    },
  };
}

// --- Factory ---

/**
 * Backend selection:
 * 1. REMOTE_QUERY_API_BASE_URL → Remote HTTP proxy
 * 2. Default → In-memory store + Nostr relay sync
 */
export function getMcpQueryBackend(): McpQueryBackend {
  const remoteBaseUrl = process.env.REMOTE_QUERY_API_BASE_URL?.trim().replace(/\/+$/, "");
  const remoteApiKey = process.env.REMOTE_QUERY_API_KEY?.trim() || process.env.HTTP_API_KEY?.trim() || "";
  if (remoteBaseUrl) {
    return createRemoteBackend(remoteBaseUrl, remoteApiKey);
  }
  return createDefaultBackend();
}
