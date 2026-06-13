import { Buffer } from "node:buffer";
import type {
  AttachmentRef,
  AttachmentStorageKind,
  BlossomKeyMaterial,
} from "../values.ts";
import type { QueryResult as RequestSubmissionResult } from "../requests/domain/types.ts";
import { inferMimeTypeFromFilename } from "./mime.ts";
import {
  attachmentRefSource,
  extractBlossomFields,
  inferAttachmentId,
  normalizeFromRef,
  normalizeFromResolved,
  normalizeFromString,
  readBlossomAttachment,
  readExternalAttachment,
} from "./attachment-helpers.ts";

type AttachmentLike = AttachmentRef | string;

export interface StoredAttachment {
  filename: string;
  mimeType: string;
  absoluteUrl: string;
  storageKind: AttachmentStorageKind;
}

export interface StoredAttachmentBuffer extends StoredAttachment {
  data: Buffer;
}

export interface StoredAttachmentStats extends StoredAttachment {
  size: number;
}

export function attachmentPublicBaseUrl(requestUrl?: string): string {
  const configured = Deno.env.get("ATTACHMENT_PUBLIC_BASE_URL") ??
    Deno.env.get("PUBLIC_BASE_URL");
  if (configured) return configured.replace(/\/+$/, "");
  if (requestUrl) {
    return new URL("/", requestUrl).toString().replace(/\/+$/, "");
  }
  // No silent localhost fallback: a relative attachment published under a
  // wrong base URL is unreachable for every counterparty.
  throw new Error(
    "Attachment base URL is not configured — set ATTACHMENT_PUBLIC_BASE_URL " +
      "(or PUBLIC_BASE_URL), or pass the incoming request URL",
  );
}

export function buildAttachmentAbsoluteUrl(
  ref: AttachmentLike,
  requestUrl?: string,
): string {
  const source = attachmentRefSource(ref);
  try {
    return new URL(source).toString();
  } catch {
    return new URL(source, `${attachmentPublicBaseUrl(requestUrl)}/`)
      .toString();
  }
}

export function normalizeAttachmentRef(
  ref: AttachmentLike,
  requestUrl?: string,
): AttachmentRef {
  const resolved = resolveStoredAttachment(ref, requestUrl);
  const blossomFields = extractBlossomFields(ref);

  if (resolved) {
    return normalizeFromResolved(ref, resolved, blossomFields);
  }

  if (typeof ref !== "string") {
    return normalizeFromRef(ref, blossomFields);
  }

  return normalizeFromString(ref);
}

export function materializeAttachmentRef(
  ref: AttachmentLike,
  requestUrl?: string,
): AttachmentRef {
  const normalized = normalizeAttachmentRef(ref, requestUrl);
  return {
    ...normalized,
    uri: buildAttachmentAbsoluteUrl(normalized, requestUrl),
  };
}

export function materializeResultAttachments(
  result: RequestSubmissionResult,
  requestUrl?: string,
): RequestSubmissionResult {
  if (!result.attachments?.length) return result;
  return {
    ...result,
    attachments: result.attachments.map((attachment) =>
      materializeAttachmentRef(attachment, requestUrl)
    ),
  };
}

export function normalizeResultAttachments(
  result: RequestSubmissionResult,
  requestUrl?: string,
): RequestSubmissionResult {
  if (!result.attachments?.length) return result;
  return {
    ...result,
    attachments: result.attachments.map((attachment) =>
      normalizeAttachmentRef(attachment, requestUrl)
    ),
  };
}

export function resolveStoredAttachment(
  ref: AttachmentLike,
  _requestUrl?: string,
): StoredAttachment | null {
  const source = attachmentRefSource(ref);
  try {
    const url = new URL(source);
    const filename = url.pathname.split("/").filter(Boolean).pop() ??
      "attachment";
    return {
      filename,
      mimeType: typeof ref === "string"
        ? inferMimeTypeFromFilename(filename)
        : ref.mime_type || inferMimeTypeFromFilename(filename),
      absoluteUrl: url.toString(),
      storageKind: typeof ref === "string" ? "external" : ref.storage_kind,
    };
  } catch {
    return null;
  }
}

export async function readStoredAttachmentAsBase64(
  ref: AttachmentLike,
  requestUrl?: string,
): Promise<(Omit<StoredAttachmentBuffer, "data"> & { data: string }) | null> {
  const attachment = await readStoredAttachmentBuffer(ref, requestUrl);
  if (!attachment) return null;

  return {
    ...attachment,
    data: attachment.data.toString("base64"),
  };
}

export async function readStoredAttachmentBuffer(
  ref: AttachmentLike,
  requestUrl?: string,
  blossomKeyMaterial?: BlossomKeyMaterial,
): Promise<StoredAttachmentBuffer | null> {
  // Handle Blossom-hosted attachments (encrypted, content-addressed)
  if (
    typeof ref !== "string" && ref.storage_kind === "blossom" &&
    ref.blossom_hash && blossomKeyMaterial
  ) {
    return readBlossomAttachment(ref, blossomKeyMaterial);
  }

  const attachment = resolveStoredAttachment(ref, requestUrl);
  if (!attachment) return null;

  return readExternalAttachment(attachment);
}

export async function statStoredAttachment(
  ref: AttachmentLike,
  requestUrl?: string,
): Promise<StoredAttachmentStats | null> {
  const attachment = resolveStoredAttachment(ref, requestUrl);
  if (!attachment) return null;

  try {
    const response = await fetch(attachment.absoluteUrl, { method: "HEAD" });
    if (!response.ok) return null;
    const sizeHeader = response.headers.get("content-length");
    return {
      ...attachment,
      size: sizeHeader ? Number(sizeHeader) : 0,
      mimeType: response.headers.get("content-type") ?? attachment.mimeType,
    };
  } catch {
    return {
      ...attachment,
      size: 0,
    };
  }
}
