import { isBlossomEnabled } from "./blossom/client";
import { workerUpload } from "./blossom/worker-upload";
import { validateC2pa } from "./verification/c2pa-validation";
import { validateExif } from "./verification/exif-validation";
import { storeIntegrity } from "./verification/integrity-store";
import type { ProofModeIntegrity } from "./verification/integrity-store";
import { parseProofModeZip } from "./verification/proofmode-validation";
import type { AttachmentRef, BlossomKeyMaterial, GpsCoord } from "../domain/types";

export interface UploadResult {
  attachment: AttachmentRef;
  /** Ephemeral key material for Blossom E2E encryption. Only returned once; never persisted. */
  encryption: BlossomKeyMaterial;
}

export interface UploadOptions {
  expectedGps?: GpsCoord;
}

/**
 * Upload an attachment: validate integrity → encrypt → upload to Blossom.
 *
 * Accepts a photo file directly, or a ProofMode zip bundle.
 * Blossom is the only storage backend. BLOSSOM_SERVERS must be configured.
 * The encryption key is returned separately and never stored on the server (E2E).
 */
export async function uploadAttachment(queryId: string, file: File, options?: UploadOptions): Promise<UploadResult> {
  if (!isBlossomEnabled()) {
    throw new Error("Blossom is not configured. Set BLOSSOM_SERVERS to enable attachment uploads.");
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const isZip = file.name.endsWith(".zip") || (rawBuffer[0] === 0x50 && rawBuffer[1] === 0x4b);

  let photoBuffer: Buffer;
  let photoFilename: string;
  let proofmode: ProofModeIntegrity | undefined;

  if (isZip) {
    // ProofMode zip bundle
    const pmData = await parseProofModeZip(rawBuffer);
    if (!pmData) {
      throw new Error("Invalid zip: no photo found in archive");
    }
    photoBuffer = pmData.photo;
    photoFilename = pmData.photoFilename;
    proofmode = {
      proof: pmData.proof,
      hashValid: pmData.hashValid,
      pgpValid: pmData.pgpValid,
      hasOts: pmData.hasOts,
      hasDeviceCheck: pmData.hasDeviceCheck,
      checks: pmData.checks,
      failures: pmData.failures,
    };
  } else {
    photoBuffer = rawBuffer;
    photoFilename = file.name;
  }

  // 1. Validate integrity on raw photo data (before any modification)
  const [exifResult, c2paResult] = await Promise.all([
    Promise.resolve(validateExif(photoBuffer, { expectedGps: options?.expectedGps })),
    validateC2pa(photoBuffer, photoFilename),
  ]);

  // 2. Upload to Blossom (handles EXIF strip + encrypt internally)
  const mimeType = photoFilename.match(/\.(png)$/i) ? "image/png"
    : photoFilename.match(/\.(heic)$/i) ? "image/heic"
    : photoFilename.match(/\.(webp)$/i) ? "image/webp"
    : "image/jpeg";

  const result = await workerUpload(
    new Uint8Array(photoBuffer),
    photoFilename,
    mimeType,
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
    proofmode,
  });
  logIntegrity(queryId, exifResult, c2paResult, proofmode);

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
  proofmode?: ProofModeIntegrity,
) {
  const checks = [...exifResult.checks, ...c2paResult.checks];
  const failures = [...exifResult.failures, ...c2paResult.failures];
  if (proofmode) {
    checks.push(...proofmode.checks);
    failures.push(...proofmode.failures);
  }
  if (checks.length > 0) {
    console.error(`[integrity] ${queryId}: ${checks.join("; ")}`);
  }
  if (failures.length > 0) {
    console.error(`[integrity] ${queryId} warnings: ${failures.join("; ")}`);
  }
}
