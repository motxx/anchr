/**
 * Internal helpers for attachment resolution and storage reading.
 */

import { Buffer } from "node:buffer";
import type {
  AttachmentRef,
  AttachmentStorageKind,
  BlossomKeyMaterial,
} from "../domain/types";
import type { StoredAttachment } from "./attachments";

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

export function extractBlossomFields(ref: AttachmentLike): Record<string, unknown> {
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
    id: baseRef?.id ?? resolved.filename ?? inferAttachmentId(attachmentRefSource(ref)),
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

export async function readBlossomAttachment(
  ref: AttachmentRef,
  blossomKeyMaterial: BlossomKeyMaterial,
): Promise<{ filename: string; mimeType: string; absoluteUrl: string; storageKind: AttachmentStorageKind; data: Buffer } | null> {
  const { downloadFromBlossom } = await import("./blossom/client");
  const data = await downloadFromBlossom(
    ref.blossom_hash!,
    blossomKeyMaterial.encrypt_key,
    blossomKeyMaterial.encrypt_iv,
    ref.blossom_servers,
  );
  if (!data) return null;
  return {
    filename: ref.filename ?? ref.blossom_hash!,
    mimeType: ref.mime_type ?? "application/octet-stream",
    absoluteUrl: ref.uri,
    storageKind: "blossom",
    data: Buffer.from(data),
  };
}

export async function readExternalAttachment(
  attachment: StoredAttachment,
): Promise<{ filename: string; mimeType: string; absoluteUrl: string; storageKind: AttachmentStorageKind; data: Buffer } | null> {
  const response = await fetch(attachment.absoluteUrl);
  if (!response.ok) return null;
  return {
    ...attachment,
    data: Buffer.from(await response.arrayBuffer()),
  };
}
