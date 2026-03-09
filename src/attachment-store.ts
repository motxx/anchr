import { S3Client } from "bun";
import { extname, join } from "node:path";
import { attachmentPublicBaseUrl } from "./attachments";
import { DEFAULT_UPLOADS_DIR } from "./config";
import { withPrivacyPipeline } from "./privacy-pipeline";
import type { AttachmentRef, AttachmentStorageKind } from "./types";

export interface UploadedAttachment {
  attachment: AttachmentRef;
  attachmentRef: string;
  absoluteUrl: string;
  filename: string;
  localFilePath?: string;
  mimeType: string;
  sizeBytes: number;
  storageKind: AttachmentStorageKind;
}

export interface AttachmentStore {
  put(queryId: string, file: File, requestUrl: string): Promise<UploadedAttachment>;
}

const LOCAL_UPLOADS_DIR = DEFAULT_UPLOADS_DIR;

function sanitizeExt(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  return ext || ".bin";
}

function awsUriEncode(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

class LocalAttachmentStore implements AttachmentStore {
  async put(queryId: string, file: File, requestUrl: string): Promise<UploadedAttachment> {
    const ext = sanitizeExt(file.name);
    const filename = `${queryId}_${Date.now()}${ext}`;
    const path = join(LOCAL_UPLOADS_DIR, filename);

    const body = Buffer.from(await file.arrayBuffer());
    await Bun.write(path, body);

    const attachmentRef = `/uploads/${filename}`;
    const attachment: AttachmentRef = {
      id: filename,
      uri: attachmentRef,
      mime_type: file.type || "application/octet-stream",
      storage_kind: "local",
      filename,
      size_bytes: body.length,
      local_file_path: path,
      route_path: attachmentRef,
    };
    return {
      attachment,
      attachmentRef,
      absoluteUrl: new URL(attachmentRef, `${attachmentPublicBaseUrl(requestUrl)}/`).toString(),
      filename,
      localFilePath: path,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: body.length,
      storageKind: "local",
    };
  }
}

interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  bucket: string;
  endpoint: string;
  region: string;
  prefix?: string;
  publicBaseUrl: string;
}

function getS3Config(): S3Config {
  const storage = process.env.ATTACHMENT_STORAGE ?? "local";
  if (storage === "localstack") {
    const bucket = process.env.LOCALSTACK_BUCKET ?? "anchr";
    const endpoint = trimTrailingSlash(process.env.LOCALSTACK_ENDPOINT ?? "http://localhost:4566");
    const publicBaseUrl = trimTrailingSlash(
      process.env.LOCALSTACK_PUBLIC_BASE_URL ?? `${endpoint}/${bucket}`,
    );

    return {
      accessKeyId: process.env.LOCALSTACK_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.LOCALSTACK_SECRET_ACCESS_KEY ?? "test",
      sessionToken: process.env.LOCALSTACK_SESSION_TOKEN,
      bucket,
      endpoint,
      region: process.env.LOCALSTACK_REGION ?? "us-east-1",
      prefix: process.env.LOCALSTACK_PREFIX?.replace(/^\/+|\/+$/g, ""),
      publicBaseUrl,
    };
  }

  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET ?? process.env.S3_BUCKET;
  const endpoint = process.env.R2_ENDPOINT
    ?? (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined)
    ?? process.env.S3_ENDPOINT;

  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    throw new Error(
      "S3-compatible storage requires either R2_* or S3_* credentials plus bucket and endpoint configuration",
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.R2_SESSION_TOKEN ?? process.env.S3_SESSION_TOKEN,
    bucket,
    endpoint: trimTrailingSlash(endpoint),
    region: process.env.R2_REGION ?? process.env.S3_REGION ?? "auto",
    prefix: (process.env.R2_PREFIX ?? process.env.S3_PREFIX)?.replace(/^\/+|\/+$/g, ""),
    publicBaseUrl: trimTrailingSlash(
      process.env.R2_PUBLIC_BASE_URL
        ?? process.env.S3_PUBLIC_BASE_URL
        ?? `${trimTrailingSlash(endpoint)}/${bucket}`,
    ),
  };
}

class S3AttachmentStore implements AttachmentStore {
  private client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
      bucket: config.bucket,
      endpoint: config.endpoint,
      region: config.region,
    });
  }

  async put(queryId: string, file: File): Promise<UploadedAttachment> {
    const ext = sanitizeExt(file.name);
    const prefix = this.config.prefix ? `${this.config.prefix}/` : "";
    const key = `${prefix}${queryId}/${Date.now()}${ext}`;
    const body = Buffer.from(await file.arrayBuffer());

    await this.client.write(key, body, { type: file.type || "application/octet-stream" });

    const filename = key.split("/").pop() ?? `${queryId}${ext}`;
    const absoluteUrl = `${this.config.publicBaseUrl}/${awsUriEncode(key)}`;
    const attachment: AttachmentRef = {
      id: filename,
      uri: absoluteUrl,
      mime_type: file.type || "application/octet-stream",
      storage_kind: "s3",
      filename,
      size_bytes: body.length,
    };
    return {
      attachment,
      attachmentRef: absoluteUrl,
      absoluteUrl,
      filename,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: body.length,
      storageKind: "s3",
    };
  }
}

function getRawStore(): AttachmentStore {
  if (["s3", "r2", "localstack"].includes(process.env.ATTACHMENT_STORAGE ?? "local")) {
    return new S3AttachmentStore(getS3Config());
  }
  return new LocalAttachmentStore();
}

/**
 * Returns a store wrapped with the privacy pipeline:
 * EXIF stripping → storage → optional Blossom mirror.
 */
export function getAttachmentStore(): AttachmentStore {
  return withPrivacyPipeline(getRawStore());
}
