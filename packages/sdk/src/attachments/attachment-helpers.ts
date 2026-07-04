/**
 * Internal helpers for attachment resolution and storage reading.
 */

import type { AttachmentRef } from "../values.ts";
import type { StoredAttachment } from "./types.ts";

type AttachmentLike = AttachmentRef | string;

export function attachmentRefSource(ref: AttachmentLike): string {
  if (typeof ref === "string") return ref;
  return ref.uri;
}

export function inferAttachmentId(value: string): string {
  try {
    const pathname = new URL(value).pathname;
    return pathname.split("/").filter(Boolean).pop() ?? value;
  } catch {
    return value.split("/").filter(Boolean).pop() ?? value;
  }
}

export function extractBlossomFields(
  ref: AttachmentLike,
): Record<string, unknown> {
  if (typeof ref === "string") return {};
  return {
    blossom_hash: ref.blossom_hash,
    blossom_servers: ref.blossom_servers,
  };
}

export function normalizeFromResolved(
  ref: AttachmentLike,
  resolved: StoredAttachment,
  blossomFields: Record<string, unknown>,
): AttachmentRef {
  const baseRef = typeof ref === "string" ? null : ref;
  return {
    id: baseRef?.id ?? resolved.filename ??
      inferAttachmentId(attachmentRefSource(ref)),
    uri: resolved.absoluteUrl,
    mime_type: baseRef?.mime_type ?? resolved.mimeType,
    storage_kind: baseRef?.storage_kind ?? resolved.storageKind,
    filename: baseRef?.filename ?? resolved.filename,
    size_bytes: baseRef?.size_bytes,
    ...blossomFields,
  };
}

export function normalizeFromRef(
  ref: AttachmentRef,
  blossomFields: Record<string, unknown>,
): AttachmentRef {
  return {
    id: ref.id || inferAttachmentId(ref.uri),
    uri: ref.uri,
    mime_type: ref.mime_type || "application/octet-stream",
    storage_kind: ref.storage_kind || "external",
    filename: ref.filename,
    size_bytes: ref.size_bytes,
    ...blossomFields,
  };
}

export function normalizeFromString(ref: string): AttachmentRef {
  return {
    id: inferAttachmentId(ref),
    uri: ref,
    mime_type: "application/octet-stream",
    storage_kind: "external",
  };
}
