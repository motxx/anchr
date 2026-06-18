import type { AttachmentRef, BlossomKeyMaterial } from "../values.ts";
import type { QueryResult as RequestSubmissionResult } from "../requests/domain/types.ts";
import {
  type AttachmentRuntimeConfig,
  getAttachmentConfig,
} from "../internal/runtime/config.ts";
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
import type {
  StoredAttachment,
  StoredAttachmentBuffer,
  StoredAttachmentStats,
} from "./types.ts";

export type { StoredAttachment, StoredAttachmentBuffer, StoredAttachmentStats };

type AttachmentLike = AttachmentRef | string;

export interface AttachmentAccessOptions {
  config?: AttachmentRuntimeConfig;
}

export function attachmentPublicBaseUrl(
  requestUrl?: string,
  options?: AttachmentAccessOptions,
): string {
  const configured = (options?.config ?? getAttachmentConfig()).publicBaseUrl;
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
  options?: AttachmentAccessOptions,
): string {
  const source = attachmentRefSource(ref);
  try {
    return new URL(source).toString();
  } catch {
    return new URL(source, `${attachmentPublicBaseUrl(requestUrl, options)}/`)
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
  options?: AttachmentAccessOptions,
): AttachmentRef {
  const normalized = normalizeAttachmentRef(ref, requestUrl);
  return {
    ...normalized,
    uri: buildAttachmentAbsoluteUrl(normalized, requestUrl, options),
  };
}

export function materializeResultAttachments(
  result: RequestSubmissionResult,
  requestUrl?: string,
  options?: AttachmentAccessOptions,
): RequestSubmissionResult {
  if (!result.attachments?.length) return result;
  return {
    ...result,
    attachments: result.attachments.map((attachment) =>
      materializeAttachmentRef(attachment, requestUrl, options)
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
