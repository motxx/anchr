/**
 * Fetch a Blossom-hosted attachment for verification.
 *
 * Downloads the encrypted blob from Blossom servers and decrypts it
 * using ephemeral key material passed as a parameter (E2E encryption).
 */

import type { AttachmentRef, BlossomKeyMaterial } from "../../domain/types";
import { downloadFromBlossom } from "./client";

/**
 * Download and decrypt a Blossom-hosted attachment.
 * Requires ephemeral key material — keys are never stored in AttachmentRef.
 * Returns the decrypted file data, or null if unavailable.
 */
export async function fetchBlossomAttachment(
  ref: AttachmentRef,
  keyMaterial?: BlossomKeyMaterial,
): Promise<Uint8Array | null> {
  if (ref.storage_kind !== "blossom") return null;
  if (!ref.blossom_hash) return null;
  if (!keyMaterial?.encrypt_key || !keyMaterial?.encrypt_iv) return null;

  return downloadFromBlossom(
    ref.blossom_hash,
    keyMaterial.encrypt_key,
    keyMaterial.encrypt_iv,
    ref.blossom_servers,
  );
}
