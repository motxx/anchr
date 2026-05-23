import { Buffer } from "node:buffer";
import { isBlossomEnabled } from "./blossom.ts";
import { workerUpload } from "./worker-upload.ts";
import {
  parseProofModeZip,
  type ProofModeIntegrity,
  storeIntegrity,
  validateC2pa,
  validateExif,
} from "../proofs/mod.ts";
import type {
  AttachmentRef,
  BlossomKeyMaterial,
  GpsCoord,
} from "../requests/domain/types.ts";
import {
  detectZip,
  extractProofModeIntegrity,
  inferMimeType,
  logIntegrity,
} from "./upload-helpers.ts";

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
export async function uploadAttachment(
  queryId: string,
  file: File,
  options?: UploadOptions,
): Promise<UploadResult> {
  if (!isBlossomEnabled()) {
    throw new Error(
      "Blossom is not configured. Set BLOSSOM_SERVERS to enable attachment uploads.",
    );
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const { photoBuffer, photoFilename, proofmode } = await extractPhotoData(
    rawBuffer,
    file.name,
  );

  const [exifResult, c2paResult] = await Promise.all([
    Promise.resolve(
      validateExif(photoBuffer, { expectedGps: options?.expectedGps }),
    ),
    validateC2pa(photoBuffer, photoFilename),
  ]);

  const result = await workerUpload(
    new Uint8Array(photoBuffer),
    photoFilename,
    inferMimeType(photoFilename),
  );
  if (!result) {
    throw new Error(`Blossom upload failed for query ${queryId}`);
  }

  const attachment = buildAttachmentRef(result);

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

async function extractPhotoData(
  rawBuffer: Buffer,
  filename: string,
): Promise<
  { photoBuffer: Buffer; photoFilename: string; proofmode?: ProofModeIntegrity }
> {
  if (!detectZip(rawBuffer, filename)) {
    return { photoBuffer: rawBuffer, photoFilename: filename };
  }

  const pmData = await parseProofModeZip(rawBuffer);
  if (!pmData) {
    throw new Error("Invalid zip: no photo found in archive");
  }

  return {
    photoBuffer: pmData.photo,
    photoFilename: pmData.photoFilename,
    proofmode: extractProofModeIntegrity(pmData),
  };
}

function buildAttachmentRef(
  result: NonNullable<Awaited<ReturnType<typeof workerUpload>>>,
): AttachmentRef {
  return {
    id: result.attachment.id,
    uri: result.attachment.uri,
    mime_type: result.attachment.mime_type,
    storage_kind: "blossom",
    filename: result.attachment.filename,
    size_bytes: result.attachment.size_bytes,
    blossom_hash: result.blossom.hash,
    blossom_servers: result.blossom.urls.map((u: string) =>
      u.replace(`/${result.blossom.hash}`, "")
    ),
  };
}
