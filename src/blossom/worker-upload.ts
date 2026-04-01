/**
 * Worker-side upload: EXIF strip → encrypt → Blossom upload.
 *
 * Workers use this to prepare attachments locally before submitting.
 * The server/oracle never receives the raw file — only the Blossom
 * reference with decryption key for verification.
 *
 * Privacy benefit: the worker's EXIF metadata (GPS, device info)
 * never leaves their device.
 */

import { stripExif } from "../infrastructure/exif-strip";
import { generateEphemeralIdentity } from "../nostr/identity";
import type { AttachmentRef } from "../domain/types";
import { getBlossomConfig, uploadToBlossom, type BlossomUploadResult } from "./client";

export interface WorkerUploadOptions {
  /** Blossom server URLs (overrides BLOSSOM_SERVERS env). */
  serverUrls?: string[];
  /** Skip EXIF stripping (e.g. if already stripped). */
  skipExifStrip?: boolean;
}

export interface WorkerUploadResult {
  /** Attachment reference ready for submission. */
  attachment: AttachmentRef;
  /** Raw Blossom upload result. */
  blossom: BlossomUploadResult;
}

/**
 * Strip EXIF, encrypt, and upload to Blossom.
 *
 * Returns an AttachmentRef with `storage_kind: "blossom"` that can be
 * included in a query result submission.
 */
export async function workerUpload(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  options?: WorkerUploadOptions,
): Promise<WorkerUploadResult | null> {
  const config = getBlossomConfig();
  const serverUrls = options?.serverUrls ?? config?.serverUrls;
  if (!serverUrls || serverUrls.length === 0) return null;

  // 1. Strip EXIF (unless skipped)
  let processed: Uint8Array;
  if (options?.skipExifStrip) {
    processed = data;
  } else {
    const stripped = await stripExif(Buffer.from(data), filename);
    processed = new Uint8Array(stripped);
  }

  // 2. Encrypt + upload to Blossom
  const identity = generateEphemeralIdentity();
  const result = await uploadToBlossom(processed, identity, serverUrls);
  if (!result) return null;

  // 3. Build attachment ref (E2E: no encryption keys stored here)
  const attachment: AttachmentRef = {
    id: result.hash,
    uri: result.urls[0]!,
    mime_type: mimeType,
    storage_kind: "blossom",
    filename,
    size_bytes: processed.length,
    blossom_hash: result.hash,
    blossom_servers: serverUrls,
  };

  return { attachment, blossom: result };
}
