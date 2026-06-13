import { generateEphemeralIdentity } from "../identity.ts";
import type { AttachmentRuntimeConfig } from "../internal/runtime/config.ts";
import type { AttachmentRef } from "../values.ts";
import {
  type BlossomUploadResult,
  getBlossomConfig,
  uploadToBlossom,
} from "./blossom.ts";

export interface ProviderUploadOptions {
  /** Blossom server URLs (overrides BLOSSOM_SERVERS env). */
  servers?: string[];
  config?: AttachmentRuntimeConfig;
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
  const config = getBlossomConfig({ config: options?.config });
  const servers = options?.servers ?? config?.servers;
  if (!servers || servers.length === 0) return null;

  const identity = generateEphemeralIdentity();
  const result = await uploadToBlossom(data, identity, servers, {
    config: options?.config,
  });
  if (!result) return null;

  // E2E: no encryption keys stored in the AttachmentRef.
  const attachment: AttachmentRef = {
    id: result.hash,
    uri: result.urls[0]!,
    mime_type: mimeType,
    storage_kind: "blossom",
    filename,
    size_bytes: data.length,
    blossom_hash: result.hash,
    blossom_servers: servers,
  };

  return { attachment, blossom: result };
}
