import {
  buildAttachmentAbsoluteUrl,
  buildAttachmentHandle,
  materializeQueryResult,
  renderStoredAttachmentPreview,
  statStoredAttachment,
} from "@anchr/bounty/attachment-access";
import type { QueryInput, QueryResult, QueryService } from "@anchr/bounty";
import type {
  AttachmentHandle,
  AttachmentRef,
  Query,
  RequesterMeta,
} from "@anchr/bounty/domain-types";

const httpApiPort = Number(Deno.env.get("HTTP_API_PORT")) || 3000;
const previewMaxDimension = Number(Deno.env.get("PREVIEW_MAX_DIMENSION")) ||
  512;
const localBaseUrl = `http://localhost:${httpApiPort}`;

// --- Shared types for MCP tool responses ---

export interface McpQueryBackend {
  createQuery(
    input: QueryInput,
    ttlSeconds: number,
    requesterMeta: RequesterMeta,
    oracleIds?: string[],
  ): Promise<unknown>;
  getQueryStatus(queryId: string): Promise<unknown>;
  listAvailableQueries(): Promise<unknown>;
  cancelQuery(queryId: string): Promise<unknown>;
  submitQueryResult(
    queryId: string,
    result: QueryResult,
    oracleId?: string,
  ): Promise<unknown>;
  getQueryAttachment(
    queryId: string,
    attachmentIndex: number,
  ): Promise<unknown>;
  getQueryAttachmentPreview(
    queryId: string,
    attachmentIndex: number,
    maxDimension?: number,
  ): Promise<{ payload: unknown; image?: { data: string; mimeType: string } }>;
}

// --- Shared helpers ---

function getAttachments(query: Query): AttachmentRef[] | null {
  if (!query.result?.attachments?.length) return null;
  return query.result.attachments;
}

function buildCreatedPayload(query: Query, baseUrl: string) {
  return {
    query_id: query.id,
    status: query.status,
    description: query.description,
    challenge_nonce: query.challenge_nonce ?? null,
    challenge_rule: query.challenge_rule ?? null,
    verification_requirements: query.verification_requirements,
    expires_at: new Date(query.expires_at).toISOString(),
    requester_meta: query.requester_meta ?? null,
    reference_app_url: `${baseUrl}/queries/${query.id}`,
    query_api_url: `${baseUrl}/queries/${query.id}`,
  };
}

function buildStatusPayload(query: Query, baseUrl: string) {
  const result = query.result
    ? materializeQueryResult(query.result, baseUrl)
    : null;
  const attachments =
    result?.attachments?.map((att: AttachmentRef, i: number) =>
      buildAttachmentHandle(query.id, i, att, baseUrl)
    ) ?? [];

  return {
    query_id: query.id,
    status: query.status,
    description: query.description,
    requester_meta: query.requester_meta ?? null,
    oracle_id: query.assigned_oracle_id ?? null,
    payment_status: query.payment_status,
    expires_in_seconds: Math.max(
      0,
      Math.floor((query.expires_at - Date.now()) / 1000),
    ),
    result,
    verification: query.verification ?? null,
    submission_meta: query.submission_meta ?? null,
    attachment_count: attachments.length,
    attachments,
    attachment_access: attachments.length > 0
      ? "Use get_query_attachment for URLs/paths, or get_query_attachment_preview for a resized preview image through MCP."
      : null,
  };
}

async function buildAttachmentPayload(
  query: Query,
  ref: AttachmentRef,
  index: number,
  baseUrl: string,
) {
  const stat = await statStoredAttachment(ref, baseUrl);
  const handle = buildAttachmentHandle(query.id, index, ref, baseUrl);
  return {
    query_id: query.id,
    attachment_index: index,
    attachment: handle.attachment,
    access: {
      ...handle.access,
      preview_url: handle.access.preview_url ?? undefined,
    },
    filename: stat?.filename ?? handle.attachment.filename ?? null,
    absolute_url: stat?.absoluteUrl ?? buildAttachmentAbsoluteUrl(ref, baseUrl),
    storage_kind: stat?.storageKind ?? handle.attachment.storage_kind,
    mime_type: stat?.mimeType ?? handle.attachment.mime_type,
    size_bytes: stat?.size ?? handle.attachment.size_bytes ?? null,
    preview_hint:
      "Use get_query_attachment_preview for a resized inline preview image.",
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
    return {
      payload: {
        query_id: query.id,
        attachment_index: index,
        attachment: handle.attachment,
        access: handle.access,
        error: "Attachment file not found",
      },
    };
  }

  const preview = await renderStoredAttachmentPreview(ref, baseUrl, {
    maxDimension: maxDimension ?? previewMaxDimension,
  });

  if (!preview) {
    return {
      payload: {
        query_id: query.id,
        attachment_index: index,
        attachment: handle.attachment,
        access: handle.access,
        error: "Preview could not be generated",
        hint:
          "Use get_query_attachment for original URLs or inspect the image in the browser.",
      },
    };
  }

  return {
    payload: {
      query_id: query.id,
      attachment_index: index,
      attachment: handle.attachment,
      access: {
        ...handle.access,
        preview_url:
          `${handle.access.preview_url}?max_dimension=${preview.maxDimension}`,
      },
      original_size_bytes: stat.size,
      preview_size_bytes: preview.size,
      preview_mime_type: preview.mimeType,
      max_dimension: preview.maxDimension,
    },
    image: { data: preview.data, mimeType: preview.mimeType },
  };
}

function errorPayload(queryId: string, index: number, message: string) {
  return {
    payload: {
      query_id: queryId,
      attachment_index: index,
      attachment: {} as AttachmentHandle["attachment"],
      access: {} as AttachmentHandle["access"],
      error: message,
    },
  };
}

// --- Default backend (in-memory + relay sync) ---

function createDefaultBackend(service: QueryService): McpQueryBackend {
  return {
    async createQuery(input, ttlSeconds, requesterMeta, oracleIds) {
      const query = service.createQuery(input, {
        ttlSeconds,
        requesterMeta,
        oracleIds,
      });
      return buildCreatedPayload(query, localBaseUrl);
    },
    async getQueryStatus(queryId) {
      const query = service.getQuery(queryId);
      return query
        ? buildStatusPayload(query, localBaseUrl)
        : { error: "Query not found" };
    },
    async listAvailableQueries() {
      return service.listOpenQueries().map((q) => ({
        query_id: q.id,
        description: q.description,
        challenge_rule: q.challenge_rule ?? null,
        verification_requirements: q.verification_requirements,
        expires_in_seconds: Math.max(
          0,
          Math.floor((q.expires_at - Date.now()) / 1000),
        ),
      }));
    },
    async cancelQuery(queryId) {
      return service.cancelQuery(queryId);
    },
    async submitQueryResult(queryId, result, oracleId) {
      const outcome = await service.submitQueryResult(queryId, result, {
        executor_type: "agent",
        channel: "adapter",
      }, oracleId);
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
      const query = service.getQuery(queryId);
      if (!query) return { error: "Query not found" };
      const attachments = getAttachments(query);
      if (!attachments) return { error: "Query does not have attachments" };
      const ref = attachments[attachmentIndex];
      if (!ref) {
        return { error: `Attachment index ${attachmentIndex} not found` };
      }
      return buildAttachmentPayload(query, ref, attachmentIndex, localBaseUrl);
    },
    async getQueryAttachmentPreview(queryId, attachmentIndex, maxDimension) {
      const query = service.getQuery(queryId);
      if (!query) {
        return errorPayload(queryId, attachmentIndex, "Query not found");
      }
      const attachments = getAttachments(query);
      if (!attachments) {
        return errorPayload(
          queryId,
          attachmentIndex,
          "Query does not have attachments",
        );
      }
      const ref = attachments[attachmentIndex];
      if (!ref) {
        return errorPayload(
          queryId,
          attachmentIndex,
          `Attachment index ${attachmentIndex} not found`,
        );
      }
      return buildPreviewPayload(
        query,
        ref,
        attachmentIndex,
        localBaseUrl,
        maxDimension,
      );
    },
  };
}

// --- Factory ---

export function getMcpQueryBackend(service: QueryService): McpQueryBackend {
  return createDefaultBackend(service);
}
