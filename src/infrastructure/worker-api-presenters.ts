import type { Context } from "hono";
import { getRuntimeConfig } from "./config";
import {
  buildAttachmentAbsoluteUrl,
  buildAttachmentHandle,
  materializeQueryResult,
  renderStoredAttachmentPreview,
  statStoredAttachment,
} from "./attachments";
import type { AttachmentRef, Query } from "../domain/types";

export const TRUSTED_HOSTS = new Set(
  (process.env.TRUSTED_PROXY_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

export function getPublicRequestUrl(c: Context): string {
  const publicBase = process.env.PUBLIC_BASE_URL;
  if (publicBase) {
    const url = new URL(c.req.url);
    const base = new URL(publicBase);
    url.protocol = base.protocol;
    url.host = base.host;
    return url.toString();
  }

  const url = new URL(c.req.url);
  const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim()?.toLowerCase();
  if (forwardedHost && TRUSTED_HOSTS.has(forwardedHost)) {
    url.host = forwardedHost;
    const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    if (forwardedProto === "https" || forwardedProto === "http") {
      url.protocol = `${forwardedProto}:`;
    }
  }
  return url.toString();
}

export function querySummary(query: Query) {
  return {
    id: query.id,
    status: query.status,
    description: query.description,
    location_hint: query.location_hint ?? null,
    requester_meta: query.requester_meta ?? null,
    bounty: query.bounty ? { amount_sats: query.bounty.amount_sats } : null,
    challenge_nonce: query.challenge_nonce ?? null,
    challenge_rule: query.challenge_rule ?? null,
    verification_requirements: query.verification_requirements,
    oracle_ids: query.oracle_ids ?? null,
    expires_at: query.expires_at,
    expires_in_seconds: Math.max(0, Math.floor((query.expires_at - Date.now()) / 1000)),
    htlc: query.htlc ? {
      hash: query.htlc.hash,
      oracle_pubkey: query.htlc.oracle_pubkey,
      worker_pubkey: query.htlc.worker_pubkey ?? null,
      locktime: query.htlc.locktime,
      verified_escrow_sats: query.htlc.verified_escrow_sats ?? null,
    } : null,
    quotes_count: query.quotes?.length ?? 0,
    expected_gps: query.expected_gps ?? null,
    max_gps_distance_km: query.max_gps_distance_km ?? null,
    tlsn_requirements: query.tlsn_requirements ?? null,
    quorum: query.quorum ?? null,
    visibility: query.visibility ?? null,
  };
}

export function buildCreatedQueryPayload(query: Query, requestUrl: string) {
  const requestOrigin = new URL(requestUrl).origin;
  return {
    query_id: query.id,
    status: query.status,
    description: query.description,
    challenge_nonce: query.challenge_nonce ?? null,
    challenge_rule: query.challenge_rule ?? null,
    verification_requirements: query.verification_requirements,
    expires_at: new Date(query.expires_at).toISOString(),
    requester_meta: query.requester_meta ?? null,
    reference_app_url: `${requestOrigin}/queries/${query.id}`,
    query_api_url: `${requestOrigin}/queries/${query.id}`,
    payment_status: query.payment_status,
    htlc: query.htlc ? { hash: query.htlc.hash, oracle_pubkey: query.htlc.oracle_pubkey } : null,
  };
}

export function queryDetail(query: Query, requestUrl: string) {
  const config = getRuntimeConfig();
  const hasTlsn = query.verification_requirements.includes("tlsn");
  return {
    ...querySummary(query),
    created_at: query.created_at,
    submitted_at: query.submitted_at,
    assigned_oracle_id: query.assigned_oracle_id ?? null,
    result: query.result ? materializeQueryResult(query.result, requestUrl) : undefined,
    verification: query.verification,
    submission_meta: query.submission_meta,
    payment_status: query.payment_status,
    blossom_keys: query.blossom_keys ?? null,
    attestations: query.attestations ?? null,
    published_proofs: query.published_proofs ?? null,
    ...(hasTlsn && {
      tlsn_verifier_url: config.tlsnVerifierUrl ?? null,
      tlsn_proxy_url: config.tlsnProxyUrl ?? null,
    }),
  };
}

export function getAttachmentRefs(query: Query): AttachmentRef[] | null {
  if (!query.result?.attachments?.length) return null;
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
    },
    attachment_view_url: handle.access.view_url,
    attachment_meta_url: handle.access.meta_url,
    absolute_url: stat?.absoluteUrl ?? buildAttachmentAbsoluteUrl(attachment, requestUrl),
    storage_kind: stat?.storageKind ?? handle.attachment.storage_kind,
    mime_type: handle.attachment.storage_kind === "blossom" ? handle.attachment.mime_type : (stat?.mimeType ?? handle.attachment.mime_type),
    size_bytes: stat?.size ?? handle.attachment.size_bytes ?? null,
  };
}

export { renderStoredAttachmentPreview };
