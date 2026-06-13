import { Buffer } from "node:buffer";
import type { AttachmentRuntimeConfig } from "../internal/runtime/config.ts";
import { isBlossomEnabled } from "./blossom.ts";
import { providerUpload } from "./provider-upload.ts";
import {
  type GpsCoord,
  parseProofModeZip,
  type ProofModeIntegrity,
  validateExif,
} from "../proofs/mod.ts";
import {
  storeContentCredentialsIntegrity,
  validateContentCredentials,
} from "../proofs/content-credentials.ts";
import type { AttachmentRef, BlossomKeyMaterial } from "../values.ts";
import {
  detectZip,
  extractProofModeIntegrity,
  logIntegrity,
} from "./upload-helpers.ts";
import { inferMimeTypeFromFilename } from "./mime.ts";

export interface UploadResult {
  attachment: AttachmentRef;
  /** Ephemeral key material for Blossom E2E encryption. Only returned once; never persisted. */
  encryption: BlossomKeyMaterial;
}

export interface UploadOptions {
  expectedGps?: GpsCoord;
  config?: AttachmentRuntimeConfig;
}

/**
 * Upload an attachment: validate integrity → encrypt → upload to Blossom.
 *
 * Accepts a photo file directly, or a ProofMode zip bundle.
 * Callers must remove private metadata such as EXIF GPS/device fields before
 * calling this API; the SDK preserves submitted bytes so evidence production
 * owns the privacy policy.
 * Blossom is the only storage backend. BLOSSOM_SERVERS must be configured.
 * The encryption key is returned separately and never stored on the server (E2E).
 */
export async function uploadAttachment(
  queryId: string,
  file: File,
  options?: UploadOptions,
): Promise<UploadResult> {
  if (!isBlossomEnabled({ config: options?.config })) {
    throw new Error(
      "Blossom is not configured. Set BLOSSOM_SERVERS to enable attachment uploads.",
    );
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const { photoBuffer, photoFilename, proofmode } = await extractPhotoData(
    rawBuffer,
    file.name,
  );

  const [exifResult, provenanceResult] = await Promise.all([
    Promise.resolve(
      validateExif(photoBuffer, { expectedGps: options?.expectedGps }),
    ),
    validateContentCredentials(photoBuffer, photoFilename),
  ]);

  const result = await providerUpload(
    new Uint8Array(photoBuffer),
    photoFilename,
    inferMimeTypeFromFilename(photoFilename),
    { config: options?.config },
  );
  if (!result) {
    throw new Error(`Blossom upload failed for query ${queryId}`);
  }

  const attachment = buildAttachmentRef(result);

  storeContentCredentialsIntegrity({
    attachmentId: attachment.id,
    requestId: queryId,
    capturedAt: Date.now(),
    exif: exifResult,
    provenance: provenanceResult,
    proofmode,
  });
  logIntegrity(queryId, exifResult, provenanceResult, proofmode);

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
  result: NonNullable<Awaited<ReturnType<typeof providerUpload>>>,
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
