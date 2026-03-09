import { createHmac, createHash } from "node:crypto";
import { extname, join } from "node:path";
import { attachmentPublicBaseUrl } from "./attachments";
import { DEFAULT_UPLOADS_DIR } from "./config";
import { withPrivacyPipeline } from "./infra/privacy-pipeline";
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

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function isoDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function shortDate(now: Date): string {
  return isoDate(now).slice(0, 8);
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
  constructor(private readonly config: S3Config) {}

  async put(queryId: string, file: File): Promise<UploadedAttachment> {
    const ext = sanitizeExt(file.name);
    const prefix = this.config.prefix ? `${this.config.prefix}/` : "";
    const key = `${prefix}${queryId}/${Date.now()}${ext}`;
    const objectPath = `/${this.config.bucket}/${awsUriEncode(key)}`;
    const url = new URL(objectPath, `${this.config.endpoint}/`);
    const body = Buffer.from(await file.arrayBuffer());
    const payloadHash = sha256Hex(body);
    const now = new Date();
    const amzDate = isoDate(now);
    const dateStamp = shortDate(now);

    const headers: Record<string, string> = {
      host: url.host,
      "content-length": String(body.length),
      "content-type": file.type || "application/octet-stream",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (this.config.sessionToken) {
      headers["x-amz-security-token"] = this.config.sessionToken;
    }

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name]!.trim()}\n`)
      .join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalRequest = [
      "PUT",
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const kDate = hmacSha256(`AWS4${this.config.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.config.region);
    const kService = hmacSha256(kRegion, "s3");
    const kSigning = hmacSha256(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    headers.authorization = [
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");

    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: new Uint8Array(body),
    });

    if (!response.ok) {
      throw new Error(`S3 upload failed with ${response.status}: ${await response.text()}`);
    }

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
