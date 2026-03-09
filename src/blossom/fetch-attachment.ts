/**
 * Fetch a Blossom-hosted attachment for verification.
 *
 * Downloads the encrypted blob from Blossom servers and decrypts it
 * using the key/IV stored in the AttachmentRef.
 */

import type { AttachmentRef } from "../types";
import { downloadFromBlossom } from "./client";

/**
 * Download and decrypt a Blossom-hosted attachment.
 * Returns the decrypted file data, or null if unavailable.
 */
export async function fetchBlossomAttachment(ref: AttachmentRef): Promise<Uint8Array | null> {
  if (ref.storage_kind !== "blossom") return null;
  if (!ref.blossom_hash || !ref.blossom_encrypt_key || !ref.blossom_encrypt_iv) return null;

  return downloadFromBlossom(
    ref.blossom_hash,
    ref.blossom_encrypt_key,
    ref.blossom_encrypt_iv,
    ref.blossom_servers,
  );
}
