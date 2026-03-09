import { buildAttachmentAbsoluteUrl, buildAttachmentHandle, materializeQueryResult, renderStoredAttachmentPreview, statStoredAttachment } from "./attachments";
import { getRuntimeConfig } from "./config";
import { cancelQuery, createQuery, getQuery, listOpenQueries, submitQueryResult, type Query, type QueryInput, type QueryResult } from "./query-service";
import type { AttachmentRef, AttachmentHandle, RequesterMeta } from "./types";

const runtimeConfig = getRuntimeConfig();
const referenceBaseUrl = `http://localhost:${runtimeConfig.referenceAppPort}`;

interface CreatedQueryPayload {
  query_id: string;
  type: string;
  status: string;
  challenge_nonce: string;
  challenge_rule: string;
  expires_at: string;
  requester_meta: RequesterMeta | null;
  reference_app_url: string;
  query_api_url: string;
}

interface QueryStatusPayload {
  query_id: string;
  type: string;
  status: string;
  requester_meta: RequesterMeta | null;
  payment_status: string;
  expires_in_seconds: number;
  result: QueryResult | null;
  verification: Query["verification"] | null;
  submission_meta: Query["submission_meta"] | null;
  attachment_count?: number;
  attachments?: AttachmentHandle[];
  attachment_access?: string | null;
}

interface AttachmentPayload {
  query_id: string;
  attachment_index: number;
  attachment: AttachmentHandle["attachment"];
  access: AttachmentHandle["access"];
  attachment_view_url?: string;
  attachment_meta_url?: string;
  filename?: string | null;
  attachment_path?: string | null;
  absolute_url: string;
  local_file_path?: string | null;
  storage_kind: string;
  mime_type: string;
  size_bytes: number | null;
  preview_hint?: string;
}

interface AttachmentPreviewPayload {
  query_id: string;
  attachment_index: number;
  attachment: AttachmentHandle["attachment"];
  access: AttachmentHandle["access"];
  original_size_bytes?: number | null;
  preview_size_bytes?: number | null;
  preview_mime_type?: string | null;
  max_dimension?: number | null;
  error?: string;
  hint?: string;
}

interface McpQueryBackend {
  createQuery(input: QueryInput, ttlSeconds: number, requesterMeta: RequesterMeta): Promise<CreatedQueryPayload>;
  getQueryStatus(queryId: string): Promise<QueryStatusPayload | { error: string }>;
  listAvailableQueries(): Promise<Array<{ query_id: string; type: string; challenge_rule: string; expires_in_seconds: number }>>;
  cancelQuery(queryId: string): Promise<unknown>;
  submitQueryResult(queryId: string, result: QueryResult): Promise<unknown>;
  getQueryAttachment(queryId: string, attachmentIndex: number): Promise<AttachmentPayload | { error: string }>;
  getQueryAttachmentPreview(
    queryId: string,
    attachmentIndex: number,
    maxDimension?: number,
  ): Promise<{ payload: AttachmentPreviewPayload; image?: { data: string; mimeType: string } }>;
}

function buildCreatedQueryPayload(query: Query): CreatedQueryPayload {
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

function buildLocalQueryStatusPayload(query: Query): QueryStatusPayload {
  const result = query.result ? materializeQueryResult(query.result, referenceBaseUrl) : null;
  const payload: QueryStatusPayload = {
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
    payload.attachment_count = attachments.length;
    payload.attachments = attachments;
    payload.attachment_access = attachments.length > 0
      ? "Use get_query_attachment for URLs/paths, or get_query_attachment_preview for a resized preview image through MCP."
      : null;
  }

  return payload;
}

function getLocalPhotoProofAttachmentRefs(query: Query): AttachmentRef[] | null {
  if (query.type !== "photo_proof" || query.result?.type !== "photo_proof") {
    return null;
  }

  return query.result.attachments;
}

function buildRemoteBaseUrl() {
  const remoteBaseUrl = process.env.REMOTE_QUERY_API_BASE_URL?.trim().replace(/\/+$/, "");
  const remoteApiKey = process.env.REMOTE_QUERY_API_KEY?.trim() || process.env.HTTP_API_KEY?.trim() || "";
  return remoteBaseUrl ? { remoteBaseUrl, remoteApiKey } : null;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON but received: ${text.slice(0, 200)}`);
  }
}

function remoteRequestHeaders(apiKey: string, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (apiKey) {
    headers.set("x-api-key", apiKey);
  }
  return headers;
}

function buildRemoteQueryStatusPayload(query: Record<string, unknown>): QueryStatusPayload {
  const result = (query.result as QueryResult | undefined) ?? null;
  const basePayload: QueryStatusPayload = {
    query_id: String(query.id),
    type: String(query.type),
    status: String(query.status),
    requester_meta: (query.requester_meta as RequesterMeta | undefined) ?? null,
    payment_status: String(query.payment_status ?? ""),
    expires_in_seconds: Number(query.expires_in_seconds ?? 0),
    result,
    verification: (query.verification as Query["verification"] | undefined) ?? null,
    submission_meta: (query.submission_meta as Query["submission_meta"] | undefined) ?? null,
  };

  if (basePayload.type === "photo_proof" && result?.type === "photo_proof") {
    const attachments = result.attachments.map((attachment, index) =>
      buildAttachmentHandle(basePayload.query_id, index, attachment, buildRemoteBaseUrl()!.remoteBaseUrl)
    );
    basePayload.attachment_count = attachments.length;
    basePayload.attachments = attachments;
    basePayload.attachment_access = attachments.length > 0
      ? "Use get_query_attachment for URLs/paths, or get_query_attachment_preview for a resized preview image through MCP."
      : null;
  }

  return basePayload;
}

function createLocalMcpQueryBackend(): McpQueryBackend {
  return {
    async createQuery(input, ttlSeconds, requesterMeta) {
      return buildCreatedQueryPayload(createQuery(input, { ttlSeconds, requesterMeta }));
    },
    async getQueryStatus(queryId) {
      const query = getQuery(queryId);
      return query ? buildLocalQueryStatusPayload(query) : { error: "Query not found" };
    },
    async listAvailableQueries() {
      return listOpenQueries().map((query) => ({
        query_id: query.id,
        type: query.type,
        challenge_rule: query.challenge_rule,
        expires_in_seconds: Math.max(0, Math.floor((query.expires_at - Date.now()) / 1000)),
      }));
    },
    async cancelQuery(queryId) {
      return cancelQuery(queryId);
    },
    async submitQueryResult(queryId, result) {
      const outcome = await submitQueryResult(queryId, result, {
        executor_type: "agent",
        channel: "mcp",
      });

      return {
        ok: outcome.ok,
        message: outcome.message,
        query_id: outcome.query?.id ?? null,
        verification: outcome.query?.verification,
        payment_status: outcome.query?.payment_status,
      };
    },
    async getQueryAttachment(queryId, attachmentIndex) {
      const query = getQuery(queryId);
      if (!query) return { error: "Query not found" };

      const attachments = getLocalPhotoProofAttachmentRefs(query);
      if (!attachments) return { error: "Query does not have photo proof attachments" };

      const attachmentRef = attachments[attachmentIndex];
      if (!attachmentRef) return { error: `Attachment index ${attachmentIndex} not found` };

      const attachmentInfo = await statStoredAttachment(attachmentRef);
      if (!attachmentInfo) return { error: "Attachment file not found" };

      const handle = buildAttachmentHandle(query.id, attachmentIndex, attachmentRef, referenceBaseUrl);
      return {
        query_id: query.id,
        attachment_index: attachmentIndex,
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
        absolute_url: attachmentInfo.absoluteUrl ?? buildAttachmentAbsoluteUrl(attachmentRef),
        local_file_path: attachmentInfo.path ?? null,
        storage_kind: attachmentInfo.storageKind,
        mime_type: attachmentInfo.mimeType,
        size_bytes: attachmentInfo.size,
        preview_hint: "Use get_query_attachment_preview for a resized inline preview image.",
      };
    },
    async getQueryAttachmentPreview(queryId, attachmentIndex, maxDimension) {
      const query = getQuery(queryId);
      if (!query) return { payload: { query_id: queryId, attachment_index: attachmentIndex, attachment: {} as AttachmentHandle["attachment"], access: {} as AttachmentHandle["access"], error: "Query not found" } };

      const attachments = getLocalPhotoProofAttachmentRefs(query);
      if (!attachments) {
        return {
          payload: {
            query_id: query.id,
            attachment_index: attachmentIndex,
            attachment: {} as AttachmentHandle["attachment"],
            access: {} as AttachmentHandle["access"],
            error: "Query does not have photo proof attachments",
          },
        };
      }

      const attachmentRef = attachments[attachmentIndex];
      if (!attachmentRef) {
        return {
          payload: {
            query_id: query.id,
            attachment_index: attachmentIndex,
            attachment: {} as AttachmentHandle["attachment"],
            access: {} as AttachmentHandle["access"],
            error: `Attachment index ${attachmentIndex} not found`,
          },
        };
      }

      const attachmentInfo = await statStoredAttachment(attachmentRef);
      if (!attachmentInfo) {
        return {
          payload: {
            query_id: query.id,
            attachment_index: attachmentIndex,
            attachment: {} as AttachmentHandle["attachment"],
            access: {} as AttachmentHandle["access"],
            error: "Attachment file not found",
          },
        };
      }

      const handle = buildAttachmentHandle(query.id, attachmentIndex, attachmentRef, referenceBaseUrl);
      const preview = await renderStoredAttachmentPreview(attachmentRef, referenceBaseUrl, {
        maxDimension: maxDimension ?? runtimeConfig.previewMaxDimension,
      });

      if (!preview) {
        return {
          payload: {
            query_id: query.id,
            attachment_index: attachmentIndex,
            attachment: handle.attachment,
            access: handle.access,
            error: "Preview could not be generated",
            hint: "Use get_query_attachment for original URLs or inspect the image in the browser.",
          },
        };
      }

      return {
        payload: {
          query_id: query.id,
          attachment_index: attachmentIndex,
          attachment: handle.attachment,
          access: {
            ...handle.access,
            preview_url: `${handle.access.preview_url}?max_dimension=${preview.maxDimension}`,
          },
          original_size_bytes: attachmentInfo.size,
          preview_size_bytes: preview.size,
          preview_mime_type: preview.mimeType,
          max_dimension: preview.maxDimension,
        },
        image: {
          data: preview.data,
          mimeType: preview.mimeType,
        },
      };
    },
  };
}

function createRemoteMcpQueryBackend(remoteBaseUrl: string, remoteApiKey: string): McpQueryBackend {
  async function requestJson(path: string, init?: RequestInit) {
    const response = await fetch(`${remoteBaseUrl}${path}`, {
      ...init,
      headers: remoteRequestHeaders(remoteApiKey, init?.headers),
    });
    const json = await parseJsonResponse(response);
    return { response, json };
  }

  async function getQueryAttachment(queryId: string, attachmentIndex: number): Promise<AttachmentPayload | { error: string }> {
    const { response, json } = await requestJson(`/queries/${queryId}/attachments/${attachmentIndex}/meta`);
    if (response.status === 404) return { error: "Attachment not found" };
    if (!response.ok) {
      throw new Error(`Remote attachment lookup failed: ${response.status} ${JSON.stringify(json)}`);
    }

    return {
      ...(json as AttachmentPayload),
      preview_hint: "Use get_query_attachment_preview for a resized inline preview image.",
    };
  }

  return {
    async createQuery(input, ttlSeconds, requesterMeta) {
      const body = { ...input, ttl_seconds: ttlSeconds, requester: requesterMeta };
      const { response, json } = await requestJson("/queries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Remote query creation failed: ${response.status} ${JSON.stringify(json)}`);
      }

      return json as CreatedQueryPayload;
    },
    async getQueryStatus(queryId) {
      const { response, json } = await requestJson(`/queries/${queryId}`);
      if (response.status === 404) return { error: "Query not found" };
      if (!response.ok) {
        throw new Error(`Remote query lookup failed: ${response.status} ${JSON.stringify(json)}`);
      }
      return buildRemoteQueryStatusPayload(json as Record<string, unknown>);
    },
    async listAvailableQueries() {
      const { response, json } = await requestJson("/queries");
      if (!response.ok) {
        throw new Error(`Remote query listing failed: ${response.status} ${JSON.stringify(json)}`);
      }

      return (json as Array<Record<string, unknown>>).map((query) => ({
        query_id: String(query.id),
        type: String(query.type),
        challenge_rule: String(query.challenge_rule),
        expires_in_seconds: Number(query.expires_in_seconds ?? 0),
      }));
    },
    async cancelQuery(queryId) {
      const { json } = await requestJson(`/queries/${queryId}/cancel`, { method: "POST" });
      return json;
    },
    async submitQueryResult(queryId, result) {
      const { json } = await requestJson(`/queries/${queryId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result),
      });
      return json;
    },
    getQueryAttachment,
    async getQueryAttachmentPreview(queryId, attachmentIndex, maxDimension) {
      const attachment = await getQueryAttachment(queryId, attachmentIndex);
      if ("error" in attachment) {
        return {
          payload: {
            query_id: queryId,
            attachment_index: attachmentIndex,
            attachment: {} as AttachmentHandle["attachment"],
            access: {} as AttachmentHandle["access"],
            error: attachment.error,
          },
        };
      }

      const previewUrl = new URL(attachment.access.preview_url ?? `${remoteBaseUrl}/queries/${queryId}/attachments/${attachmentIndex}/preview`);
      if (maxDimension) {
        previewUrl.searchParams.set("max_dimension", String(maxDimension));
      }

      const response = await fetch(previewUrl, {
        headers: remoteRequestHeaders(remoteApiKey),
      });
      if (!response.ok) {
        return {
          payload: {
            query_id: queryId,
            attachment_index: attachmentIndex,
            attachment: attachment.attachment,
            access: attachment.access,
            error: "Preview could not be generated",
            hint: "Use get_query_attachment for original URLs or inspect the image in the browser.",
          },
        };
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const mimeType = response.headers.get("content-type") ?? "image/jpeg";
      return {
        payload: {
          query_id: queryId,
          attachment_index: attachmentIndex,
          attachment: attachment.attachment,
          access: {
            ...attachment.access,
            preview_url: previewUrl.toString(),
          },
          original_size_bytes: attachment.size_bytes,
          preview_size_bytes: bytes.length,
          preview_mime_type: mimeType,
          max_dimension: maxDimension ?? runtimeConfig.previewMaxDimension,
        },
        image: {
          data: bytes.toString("base64"),
          mimeType,
        },
      };
    },
  };
}

export function getMcpQueryBackend(): McpQueryBackend {
  const remoteConfig = buildRemoteBaseUrl();
  if (remoteConfig) {
    return createRemoteMcpQueryBackend(remoteConfig.remoteBaseUrl, remoteConfig.remoteApiKey);
  }
  return createLocalMcpQueryBackend();
}
