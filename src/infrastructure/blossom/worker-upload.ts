// Worker-side: EXIF strip happens locally so GPS/device metadata never
// leaves the worker's device.

import { Buffer } from "node:buffer";
import { stripExif } from "../exif-strip.ts";
import { generateEphemeralIdentity } from "../nostr/crypto/identity.ts";
import type { AttachmentRef } from "../../domain/types.ts";
import { getBlossomConfig, uploadToBlossom, type BlossomUploadResult } from "@anchr/blossom";

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

export async function workerUpload(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  options?: WorkerUploadOptions,
): Promise<WorkerUploadResult | null> {
  const config = getBlossomConfig();
  const serverUrls = options?.serverUrls ?? config?.serverUrls;
  if (!serverUrls || serverUrls.length === 0) return null;

  let processed: Uint8Array;
  if (options?.skipExifStrip) {
    processed = data;
  } else {
    const stripped = await stripExif(Buffer.from(data), filename);
    processed = new Uint8Array(stripped);
  }

  const identity = generateEphemeralIdentity();
  const result = await uploadToBlossom(processed, identity, serverUrls);
  if (!result) return null;

  // E2E: no encryption keys stored in the AttachmentRef.
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
