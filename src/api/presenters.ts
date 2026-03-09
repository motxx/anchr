import type { Context } from "hono";
import {
  buildAttachmentAbsoluteUrl,
  buildAttachmentHandle,
  materializeQueryResult,
  statStoredAttachment,
} from "../attachments";
import type { AttachmentRef, Query, QueryResult } from "../types";

export function querySummary(query: Query) {
  return {
    id: query.id,
    type: query.type,
    status: query.status,
    params: query.params,
    requester_meta: query.requester_meta ?? null,
    bounty: query.bounty ? { amount_sats: query.bounty.amount_sats } : null,
    challenge_nonce: query.challenge_nonce,
    challenge_rule: query.challenge_rule,
    expires_at: query.expires_at,
    expires_in_seconds: Math.max(0, Math.floor((query.expires_at - Date.now()) / 1000)),
  };
}

export function buildCreatedQueryPayload(query: Query, requestUrl: string) {
  const requestOrigin = new URL(requestUrl).origin;
  return {
    query_id: query.id,
    type: query.type,
    status: query.status,
    challenge_nonce: query.challenge_nonce,
    challenge_rule: query.challenge_rule,
    expires_at: new Date(query.expires_at).toISOString(),
    requester_meta: query.requester_meta ?? null,
    reference_app_url: `${requestOrigin}/queries/${query.id}`,
    query_api_url: `${requestOrigin}/queries/${query.id}`,
  };
}

export function getPublicRequestUrl(c: Context): string {
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || c.req.header("host")?.trim();

  if (forwardedProto) {
    url.protocol = `${forwardedProto}:`;
  }
  if (host) {
    url.host = host;
  }

  return url.toString();
}

function materializeResult(result: QueryResult | undefined, requestUrl: string): QueryResult | undefined {
  if (!result) return undefined;
  return materializeQueryResult(result, requestUrl);
}

export function queryDetail(query: Query, requestUrl: string) {
  return {
    ...querySummary(query),
    created_at: query.created_at,
    submitted_at: query.submitted_at,
    result: materializeResult(query.result, requestUrl),
    verification: query.verification,
    submission_meta: query.submission_meta,
    payment_status: query.payment_status,
  };
}

export function getPhotoProofAttachmentRefs(query: Query): AttachmentRef[] | null {
  if (query.type !== "photo_proof" || query.result?.type !== "photo_proof") {
    return null;
  }

  return query.result.attachments;
}

export async function buildAttachmentPayload(query: Query, attachment: AttachmentRef, index: number, requestUrl: string) {
  const stat = await statStoredAttachment(attachment, requestUrl);
  const handle = buildAttachmentHandle(query.id, index, attachment, requestUrl);

  return {
    query_id: query.id,
    attachment_index: index,
    attachment: handle.attachment,
    access: {
      ...handle.access,
      preview_url: handle.access.preview_url ?? undefined,
      local_file_path: stat?.path ?? handle.access.local_file_path ?? undefined,
    },
    attachment_view_url: handle.access.view_url,
    attachment_meta_url: handle.access.meta_url,
    absolute_url: stat?.absoluteUrl ?? buildAttachmentAbsoluteUrl(attachment, requestUrl),
    local_file_path: stat?.path ?? null,
    storage_kind: stat?.storageKind ?? handle.attachment.storage_kind,
    mime_type: stat?.mimeType ?? handle.attachment.mime_type,
    size_bytes: stat?.size ?? handle.attachment.size_bytes ?? null,
  };
}
