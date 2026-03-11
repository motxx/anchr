import { isBlossomEnabled } from "./blossom/client";
import { workerUpload } from "./blossom/worker-upload";
import { validateC2pa } from "./verification/c2pa-validation";
import { validateExif } from "./verification/exif-validation";
import { storeIntegrity } from "./verification/integrity-store";
import type { AttachmentRef, BlossomKeyMaterial } from "./types";

export interface UploadResult {
  attachment: AttachmentRef;
  /** Ephemeral key material for Blossom E2E encryption. Only returned once; never persisted. */
  encryption: BlossomKeyMaterial;
}

/**
 * Upload an attachment: validate integrity → encrypt → upload to Blossom.
 *
 * Blossom is the only storage backend. BLOSSOM_SERVERS must be configured.
 * The encryption key is returned separately and never stored on the server (E2E).
 */
export async function uploadAttachment(queryId: string, file: File): Promise<UploadResult> {
  if (!isBlossomEnabled()) {
    throw new Error("Blossom is not configured. Set BLOSSOM_SERVERS to enable attachment uploads.");
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());

  // 1. Validate integrity on raw data (before any modification)
  const [exifResult, c2paResult] = await Promise.all([
    Promise.resolve(validateExif(rawBuffer)),
    validateC2pa(rawBuffer, file.name),
  ]);

  // 2. Upload to Blossom (handles EXIF strip + encrypt internally)
  const result = await workerUpload(
    new Uint8Array(rawBuffer),
    file.name,
    file.type || "application/octet-stream",
  );
  if (!result) {
    throw new Error(`Blossom upload failed for query ${queryId}`);
  }

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
