import type {
  AttachmentRef,
  BlossomKeyMap,
  BlossomKeyMaterial,
} from "../values.ts";
import type { AttachmentRuntimeConfig } from "../internal/runtime/config.ts";
import { downloadFromBlossom } from "./blossom.ts";
import { validateAttachmentUri } from "./url-validation.ts";

export interface FetchAttachmentOptions {
  config?: AttachmentRuntimeConfig;
}

// Ephemeral key material is required: keys are never stored in AttachmentRef.
export async function fetchBlossomAttachment(
  ref: AttachmentRef,
  keyMaterial?: BlossomKeyMaterial,
  options?: FetchAttachmentOptions,
): Promise<Uint8Array | null> {
  if (ref.storage_kind !== "blossom") return null;
  if (!ref.blossom_hash) return null;
  if (!keyMaterial?.encrypt_key || !keyMaterial?.encrypt_iv) return null;

  return downloadFromBlossom(
    ref.blossom_hash,
    keyMaterial.encrypt_key,
    keyMaterial.encrypt_iv,
    ref.blossom_servers,
    { config: options?.config },
  );
}

export type AttachmentDataResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; reason: string };

/**
 * Retrieve an attachment's bytes: Blossom (decrypted with the per-attachment
 * key) first, then the SSRF-guarded plain URI.
 */
export async function fetchAttachmentData(
  ref: AttachmentRef,
  blossomKeys?: BlossomKeyMap,
  options?: FetchAttachmentOptions,
): Promise<AttachmentDataResult> {
  if (ref.storage_kind === "blossom") {
    const keyMaterial = blossomKeys?.[ref.id];
    const data = await fetchBlossomAttachment(ref, keyMaterial, options);
    if (data) return { ok: true, data };
  }

  if (ref.uri) {
    const uriError = validateAttachmentUri(ref.uri, {
      config: options?.config,
    });
    if (uriError) {
      return { ok: false, reason: `attachment URI rejected (${uriError})` };
    }
    try {
      const response = await fetch(ref.uri);
      if (response.ok) {
        return {
          ok: true,
          data: new Uint8Array(await response.arrayBuffer()),
        };
      }
    } catch {
      // fetch failed — fall through to the generic reason
    }
  }

  return { ok: false, reason: "attachment could not be retrieved" };
}
