/**
 * Privacy pipeline: EXIF stripping + optional Blossom mirror.
 *
 * Wraps any AttachmentStore to apply privacy-preserving transforms
 * before storage, and optionally mirror encrypted copies to Blossom.
 * The underlying stores handle pure storage only.
 */

import { isBlossomEnabled, uploadToBlossom } from "./blossom/client";
import { stripExif } from "./exif-strip";
import { generateEphemeralIdentity } from "./nostr/identity";
import type { AttachmentStore, UploadedAttachment } from "./attachment-store";

class ExifStrippingStore implements AttachmentStore {
  constructor(private readonly inner: AttachmentStore) {}

  async put(queryId: string, file: File, requestUrl: string): Promise<UploadedAttachment> {
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const stripped = await stripExif(rawBuffer, file.name);
    const strippedFile = new File([new Uint8Array(stripped)], file.name, { type: file.type });
    return this.inner.put(queryId, strippedFile, requestUrl);
  }
}

class BlossomMirrorStore implements AttachmentStore {
  constructor(private readonly inner: AttachmentStore) {}

  async put(queryId: string, file: File, requestUrl: string): Promise<UploadedAttachment> {
    const result = await this.inner.put(queryId, file, requestUrl);

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const identity = generateEphemeralIdentity();
      const blossomResult = await uploadToBlossom(new Uint8Array(buffer), identity);
      if (blossomResult) {
        console.error(
          `[blossom] Mirrored ${queryId} → ${blossomResult.hash} (${blossomResult.urls.length} server(s))`,
        );
      }
    } catch (err) {
      console.error("[blossom] Mirror upload failed:", err);
    }

    return result;
  }
}

/**
 * Apply the full privacy pipeline to a store:
 * 1. EXIF stripping (always)
 * 2. Blossom mirror (if configured)
 */
export function withPrivacyPipeline(store: AttachmentStore): AttachmentStore {
  let result: AttachmentStore = new ExifStrippingStore(store);
  if (isBlossomEnabled()) {
    result = new BlossomMirrorStore(result);
  }
  return result;
}
