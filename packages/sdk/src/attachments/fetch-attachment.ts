import type { AttachmentRef, BlossomKeyMaterial } from "../values.ts";
import { downloadFromBlossom } from "./blossom.ts";

// Ephemeral key material is required: keys are never stored in AttachmentRef.
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
