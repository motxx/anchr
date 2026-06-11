// Provider-side: EXIF strip happens locally so GPS/device metadata never
// leaves the provider's device.

import { Buffer } from "node:buffer";
import { generateEphemeralIdentity } from "../identity.ts";
import type { AttachmentRef } from "../values.ts";
import { stripExif } from "./exif-strip.ts";
import {
  type BlossomUploadResult,
  getBlossomConfig,
  uploadToBlossom,
} from "./blossom.ts";

export interface ProviderUploadOptions {
  /** Blossom server URLs (overrides BLOSSOM_SERVERS env). */
  servers?: string[];
  /** Skip EXIF stripping (e.g. if already stripped). */
  skipExifStrip?: boolean;
}

export interface ProviderUploadResult {
  /** Attachment reference ready for submission. */
  attachment: AttachmentRef;
  /** Raw Blossom upload result. */
  blossom: BlossomUploadResult;
}

export async function providerUpload(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  options?: ProviderUploadOptions,
): Promise<ProviderUploadResult | null> {
  const config = getBlossomConfig();
  const servers = options?.servers ?? config?.servers;
  if (!servers || servers.length === 0) return null;

  let processed: Uint8Array;
  if (options?.skipExifStrip) {
    processed = data;
  } else {
    const stripped = await stripExif(Buffer.from(data), filename);
    processed = new Uint8Array(stripped);
  }

  const identity = generateEphemeralIdentity();
  const result = await uploadToBlossom(processed, identity, servers);
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
    blossom_servers: servers,
  };

  return { attachment, blossom: result };
}
