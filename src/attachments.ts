import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { DEFAULT_UPLOADS_DIR, getRuntimeConfig } from "./config";
import type {
  AttachmentAccess,
  AttachmentHandle,
  AttachmentRef,
  AttachmentStorageKind,
  QueryResult,
} from "./types";

type AttachmentLike = AttachmentRef | string;

export const UPLOADS_DIR = DEFAULT_UPLOADS_DIR;
export const UPLOADS_ROUTE_PREFIX = "/uploads/";

const MIME_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export interface StoredAttachment {
  filename: string;
  mimeType: string;
  absoluteUrl: string;
  storageKind: AttachmentStorageKind;
  path?: string;
  routePath?: string;
}

export interface AttachmentPreview {
  data: string;
  mimeType: string;
  filename: string;
  size: number;
  maxDimension: number;
}

function resolvePreviewCommand():
  | { command: string; args: (inputPath: string, outputPath: string, maxDimension: number, jpegQuality: number) => string[] }
  | null {
  if (process.platform === "darwin") {
    return {
      command: "/usr/bin/sips",
      args: (inputPath, outputPath, maxDimension, jpegQuality) => [
        "-Z",
        String(maxDimension),
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        String(jpegQuality),
        inputPath,
        "--out",
        outputPath,
      ],
    };
  }

  const magick = Bun.which("magick");
  if (magick) {
    return {
      command: magick,
      args: (inputPath, outputPath, maxDimension, jpegQuality) => [
        inputPath,
        "-auto-orient",
        "-thumbnail",
        `${maxDimension}x${maxDimension}>`,
        "-strip",
        "-quality",
        String(jpegQuality),
        outputPath,
      ],
    };
  }

  const convert = Bun.which("convert");
  if (convert) {
    return {
      command: convert,
      args: (inputPath, outputPath, maxDimension, jpegQuality) => [
        inputPath,
        "-auto-orient",
        "-thumbnail",
        `${maxDimension}x${maxDimension}>`,
        "-strip",
        "-quality",
        String(jpegQuality),
        outputPath,
      ],
    };
  }

  return null;
}

function attachmentRefSource(ref: AttachmentLike): string {
  if (typeof ref === "string") return ref;
  if (ref.storage_kind === "local" && ref.route_path) return ref.route_path;
  return ref.uri;
}

function attachmentPathname(ref: AttachmentLike): string | null {
  try {
    return new URL(attachmentRefSource(ref)).pathname;
  } catch {
    return attachmentRefSource(ref);
  }
}

function inferAttachmentId(value: string): string {
  try {
    const pathname = new URL(value).pathname;
    return pathname.split("/").filter(Boolean).pop() ?? value;
  } catch {
    return value.split("/").filter(Boolean).pop() ?? value;
  }
}

function inferMimeTypeFromFilename(filename: string): string {
  return MIME_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

export function attachmentPublicBaseUrl(requestUrl?: string): string {
  const configured = process.env.ATTACHMENT_PUBLIC_BASE_URL ?? process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (requestUrl) return new URL("/", requestUrl).toString().replace(/\/+$/, "");
  return `http://localhost:${getRuntimeConfig().referenceAppPort}`;
}

export function buildAttachmentAbsoluteUrl(ref: AttachmentLike, requestUrl?: string): string {
  const source = attachmentRefSource(ref);
  try {
    return new URL(source).toString();
  } catch {
    return new URL(source, `${attachmentPublicBaseUrl(requestUrl)}/`).toString();
  }
}

export function normalizeAttachmentRef(ref: AttachmentLike, requestUrl?: string): AttachmentRef {
  const resolved = resolveStoredAttachment(ref, requestUrl);
  if (resolved) {
    const baseRef = typeof ref === "string" ? null : ref;
    return {
      id: baseRef?.id ?? resolved.filename ?? inferAttachmentId(attachmentRefSource(ref)),
      uri: baseRef?.storage_kind === "local" && baseRef.route_path
        ? baseRef.route_path
        : resolved.routePath ?? resolved.absoluteUrl,
      mime_type: baseRef?.mime_type ?? resolved.mimeType,
      storage_kind: baseRef?.storage_kind ?? resolved.storageKind,
      filename: baseRef?.filename ?? resolved.filename,
      size_bytes: baseRef?.size_bytes,
      local_file_path: baseRef?.local_file_path ?? resolved.path,
      route_path: baseRef?.route_path ?? resolved.routePath,
    };
  }

  if (typeof ref !== "string") {
    return {
      id: ref.id || inferAttachmentId(ref.uri),
      uri: ref.uri,
      mime_type: ref.mime_type || "application/octet-stream",
      storage_kind: ref.storage_kind || "external",
      filename: ref.filename,
      size_bytes: ref.size_bytes,
      local_file_path: ref.local_file_path,
      route_path: ref.route_path,
    };
  }

  return {
    id: inferAttachmentId(ref),
    uri: ref,
    mime_type: "application/octet-stream",
    storage_kind: "external",
  };
}

export function materializeAttachmentRef(ref: AttachmentLike, requestUrl?: string): AttachmentRef {
  const normalized = normalizeAttachmentRef(ref, requestUrl);
  return {
    ...normalized,
    uri: buildAttachmentAbsoluteUrl(normalized, requestUrl),
  };
}

export function materializeQueryResult(result: QueryResult, requestUrl?: string): QueryResult {
  if (result.type !== "photo_proof") {
    return result;
  }

  return {
    ...result,
    attachments: result.attachments.map((attachment) => materializeAttachmentRef(attachment, requestUrl)),
  };
}

export function buildQueryAttachmentUrls(queryId: string, attachmentIndex: number, requestUrl?: string) {
  const baseUrl = attachmentPublicBaseUrl(requestUrl);
  return {
    viewUrl: new URL(`/queries/${queryId}/attachments/${attachmentIndex}`, `${baseUrl}/`).toString(),
    metaUrl: new URL(`/queries/${queryId}/attachments/${attachmentIndex}/meta`, `${baseUrl}/`).toString(),
    previewUrl: new URL(`/queries/${queryId}/attachments/${attachmentIndex}/preview`, `${baseUrl}/`).toString(),
  };
}

export function buildAttachmentAccess(
  queryId: string,
  attachmentIndex: number,
  ref: AttachmentLike,
  requestUrl?: string,
): AttachmentAccess {
  const originalUrl = buildAttachmentAbsoluteUrl(ref, requestUrl);
  const { viewUrl, metaUrl, previewUrl } = buildQueryAttachmentUrls(queryId, attachmentIndex, requestUrl);
  const normalized = normalizeAttachmentRef(ref, requestUrl);

  return {
    original_url: originalUrl,
    preview_url: previewUrl,
    view_url: viewUrl,
    meta_url: metaUrl,
    local_file_path: normalized.local_file_path,
  };
}

export function buildAttachmentHandle(
  queryId: string,
  attachmentIndex: number,
  ref: AttachmentLike,
  requestUrl?: string,
): AttachmentHandle {
  return {
    attachment: materializeAttachmentRef(ref, requestUrl),
    access: buildAttachmentAccess(queryId, attachmentIndex, ref, requestUrl),
  };
}

export function normalizeQueryResult(result: QueryResult, requestUrl?: string): QueryResult {
  if (result.type !== "photo_proof") {
    return result;
  }

  return {
    ...result,
    attachments: result.attachments.map((attachment) => normalizeAttachmentRef(attachment, requestUrl)),
  };
}

export function resolveStoredAttachment(ref: AttachmentLike, requestUrl?: string): StoredAttachment | null {
  const source = attachmentRefSource(ref);
  try {
    const url = new URL(source);
    const filename = url.pathname.split("/").filter(Boolean).pop() ?? "attachment";
    return {
      filename,
      mimeType: typeof ref === "string" ? inferMimeTypeFromFilename(filename) : ref.mime_type || inferMimeTypeFromFilename(filename),
      absoluteUrl: url.toString(),
      storageKind: typeof ref === "string" ? "external" : ref.storage_kind,
      path: typeof ref === "string" ? undefined : ref.local_file_path,
      routePath: typeof ref === "string" ? undefined : ref.route_path,
    };
  } catch {
    // fall through to local path resolution
  }

  const pathname = attachmentPathname(ref);
  if (!pathname || !pathname.startsWith(UPLOADS_ROUTE_PREFIX)) {
    return null;
  }

  const filename = pathname.slice(UPLOADS_ROUTE_PREFIX.length);
  if (!filename || filename.includes("/") || filename.includes("..")) {
    return null;
  }

  return {
    filename,
    mimeType: typeof ref === "string" ? inferMimeTypeFromFilename(filename) : ref.mime_type || inferMimeTypeFromFilename(filename),
    absoluteUrl: buildAttachmentAbsoluteUrl(
      typeof ref === "string" ? `${UPLOADS_ROUTE_PREFIX}${filename}` : ref.route_path ?? ref.uri,
      requestUrl,
    ),
    storageKind: typeof ref === "string" ? "local" : ref.storage_kind,
    path: typeof ref === "string" ? join(UPLOADS_DIR, filename) : ref.local_file_path ?? join(UPLOADS_DIR, filename),
    routePath: typeof ref === "string" ? `${UPLOADS_ROUTE_PREFIX}${filename}` : ref.route_path ?? `${UPLOADS_ROUTE_PREFIX}${filename}`,
  };
}

export async function readStoredAttachmentAsBase64(ref: AttachmentLike, requestUrl?: string) {
  const attachment = await readStoredAttachmentBuffer(ref, requestUrl);
  if (!attachment) return null;

  return {
    ...attachment,
    data: attachment.data.toString("base64"),
  };
}

export async function readStoredAttachmentBuffer(ref: AttachmentLike, requestUrl?: string) {
  // Handle Blossom-hosted attachments (encrypted, content-addressed)
  if (typeof ref !== "string" && ref.storage_kind === "blossom" && ref.blossom_hash && ref.blossom_encrypt_key && ref.blossom_encrypt_iv) {
    const { downloadFromBlossom } = await import("./blossom/client");
    const data = await downloadFromBlossom(ref.blossom_hash, ref.blossom_encrypt_key, ref.blossom_encrypt_iv, ref.blossom_servers);
    if (!data) return null;
    return {
      filename: ref.filename ?? ref.blossom_hash,
      mimeType: ref.mime_type ?? "application/octet-stream",
      absoluteUrl: ref.uri,
      storageKind: "blossom" as AttachmentStorageKind,
      data: Buffer.from(data),
    };
  }

  const attachment = resolveStoredAttachment(ref, requestUrl);
  if (!attachment) return null;

  if (attachment.storageKind !== "local") {
    const response = await fetch(attachment.absoluteUrl);
    if (!response.ok) return null;
    return {
      ...attachment,
      data: Buffer.from(await response.arrayBuffer()),
    };
  }

  const file = Bun.file(attachment.path!);
  if (!(await file.exists())) return null;

  return {
    ...attachment,
    data: Buffer.from(await file.arrayBuffer()),
  };
}

export async function renderStoredAttachmentPreview(
  ref: AttachmentLike,
  requestUrl?: string,
  options?: { maxDimension?: number; jpegQuality?: number },
): Promise<AttachmentPreview | null> {
  const attachment = await readStoredAttachmentBuffer(ref, requestUrl);
  if (!attachment) return null;

  if (!attachment.mimeType.startsWith("image/")) {
    return null;
  }

  const runtimeConfig = getRuntimeConfig();
  const maxDimension = options?.maxDimension ?? runtimeConfig.previewMaxDimension;
  const jpegQuality = options?.jpegQuality ?? runtimeConfig.previewJpegQuality;
  const previewCommand = resolvePreviewCommand();
  if (!previewCommand) {
    return null;
  }
  const tempDir = await mkdtemp(join(tmpdir(), "anchr-preview-"));
  const inputExt = extname(attachment.filename) || ".bin";
  const inputPath = join(tempDir, `input${inputExt}`);
  const outputPath = join(tempDir, "preview.jpg");

  try {
    await Bun.write(inputPath, attachment.data);
    const proc = Bun.spawn([
      previewCommand.command,
      ...previewCommand.args(inputPath, outputPath, maxDimension, jpegQuality),
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      return null;
    }

    const output = Bun.file(outputPath);
    if (!(await output.exists())) {
      return null;
    }

    const data = Buffer.from(await output.arrayBuffer());
    return {
      data: data.toString("base64"),
      mimeType: "image/jpeg",
      filename: `${attachment.filename.replace(/\.[^.]+$/, "") || "preview"}.preview.jpg`,
      size: data.length,
      maxDimension,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function statStoredAttachment(ref: AttachmentLike, requestUrl?: string) {
  const attachment = resolveStoredAttachment(ref, requestUrl);
  if (!attachment) return null;

  if (attachment.storageKind !== "local") {
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

  const file = Bun.file(attachment.path!);
  if (!(await file.exists())) return null;

  return {
    ...attachment,
    size: file.size,
  };
}
