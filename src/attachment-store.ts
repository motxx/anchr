import { extname, join } from "node:path";
import { DEFAULT_UPLOADS_DIR } from "./config";
import { isBlossomEnabled } from "./blossom/client";
import { workerUpload } from "./blossom/worker-upload";
import { stripExif } from "./exif-strip";
import { validateC2pa } from "./verification/c2pa-validation";
import { validateExif } from "./verification/exif-validation";
import { storeIntegrity } from "./verification/integrity-store";
import type { AttachmentRef, BlossomKeyMaterial } from "./types";

export interface UploadResult {
  attachment: AttachmentRef;
  /** Ephemeral key material for Blossom E2E encryption. Only returned once; never persisted. */
  encryption?: BlossomKeyMaterial;
}

function sanitizeExt(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  return ext || ".bin";
}

/**
 * Upload an attachment: validate integrity → strip EXIF → store.
 * When BLOSSOM_SERVERS is configured, encrypts and uploads to Blossom.
 * Otherwise falls back to local disk storage.
 *
 * For Blossom uploads, the encryption key is returned separately and
 * never stored on the server (E2E encryption).
 */
export async function uploadAttachment(queryId: string, file: File): Promise<UploadResult> {
  const rawBuffer = Buffer.from(await file.arrayBuffer());

  // 1. Validate integrity on raw data (before any modification)
  const [exifResult, c2paResult] = await Promise.all([
    Promise.resolve(validateExif(rawBuffer)),
    validateC2pa(rawBuffer, file.name),
  ]);

  // 2. Upload to Blossom if configured (handles EXIF strip + encrypt internally)
  if (isBlossomEnabled()) {
    const result = await workerUpload(
      new Uint8Array(rawBuffer),
      file.name,
      file.type || "application/octet-stream",
    );
    if (result) {
      // Store AttachmentRef WITHOUT encryption keys
      const attachment: AttachmentRef = {
        id: result.attachment.id,
        uri: result.attachment.uri,
        mime_type: result.attachment.mime_type,
        storage_kind: "blossom",
        filename: result.attachment.filename,
        size_bytes: result.attachment.size_bytes,
        blossom_hash: result.blossom.hash,
        blossom_servers: result.blossom.urls.map((u) => u.replace(`/${result.blossom.hash}`, "")),
      };
      storeIntegrity({
        attachmentId: attachment.id,
        queryId,
        capturedAt: Date.now(),
        exif: exifResult,
        c2pa: c2paResult,
      });
      logIntegrity(queryId, exifResult, c2paResult);
      return {
        attachment,
        encryption: {
          encrypt_key: result.blossom.encryptKey,
          encrypt_iv: result.blossom.encryptIv,
        },
      };
    }
    console.error(`[blossom] Upload failed for ${queryId}, falling back to local storage`);
  }

  // 3. Fallback: strip EXIF → save to local disk
  const stripped = await stripExif(rawBuffer, file.name);
  const ext = sanitizeExt(file.name);
  const filename = `${queryId}_${Date.now()}${ext}`;
  const path = join(DEFAULT_UPLOADS_DIR, filename);
  await Bun.write(path, stripped);

  const routePath = `/uploads/${filename}`;
  const attachment: AttachmentRef = {
    id: filename,
    uri: routePath,
    mime_type: file.type || "application/octet-stream",
    storage_kind: "local",
    filename,
    size_bytes: stripped.length,
    local_file_path: path,
    route_path: routePath,
  };

  storeIntegrity({
    attachmentId: attachment.id,
    queryId,
    capturedAt: Date.now(),
    exif: exifResult,
    c2pa: c2paResult,
  });
  logIntegrity(queryId, exifResult, c2paResult);

  return { attachment };
}

function logIntegrity(
  queryId: string,
  exifResult: { checks: string[]; failures: string[] },
  c2paResult: { checks: string[]; failures: string[] },
) {
  const checks = [...exifResult.checks, ...c2paResult.checks];
  const failures = [...exifResult.failures, ...c2paResult.failures];
  if (checks.length > 0) {
    console.error(`[integrity] ${queryId}: ${checks.join("; ")}`);
  }
  if (failures.length > 0) {
    console.error(`[integrity] ${queryId} warnings: ${failures.join("; ")}`);
  }
}
