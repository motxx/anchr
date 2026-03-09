/**
 * Privacy pipeline: integrity validation → EXIF stripping → optional Blossom mirror.
 *
 * Wraps any AttachmentStore to:
 * 1. Extract and validate EXIF/C2PA metadata BEFORE stripping (integrity)
 * 2. Strip EXIF for privacy
 * 3. Optionally mirror encrypted copies to Blossom
 */

import { isBlossomEnabled, uploadToBlossom } from "./blossom/client";
import { stripExif } from "./exif-strip";
import { generateEphemeralIdentity } from "./nostr/identity";
import { validateC2pa } from "./verification/c2pa-validation";
import { validateExif } from "./verification/exif-validation";
import { storeIntegrity } from "./verification/integrity-store";
import type { AttachmentStore, UploadedAttachment } from "./attachment-store";

class IntegrityValidationStore implements AttachmentStore {
  constructor(private readonly inner: AttachmentStore) {}

  async put(queryId: string, file: File, requestUrl: string): Promise<UploadedAttachment> {
    const rawBuffer = Buffer.from(await file.arrayBuffer());

    // Run EXIF + C2PA validation on raw data (before any modification)
    const [exifResult, c2paResult] = await Promise.all([
      Promise.resolve(validateExif(rawBuffer)),
      validateC2pa(rawBuffer, file.name),
    ]);

    // Store to inner pipeline (which will strip EXIF, then persist)
    const rawFile = new File([new Uint8Array(rawBuffer)], file.name, { type: file.type });
    const result = await this.inner.put(queryId, rawFile, requestUrl);

    // Persist integrity metadata (keyed by attachment ID for lookup at verification time)
    storeIntegrity({
      attachmentId: result.attachment.id,
      queryId,
      capturedAt: Date.now(),
      exif: exifResult,
      c2pa: c2paResult,
    });

    const integrityChecks = [...exifResult.checks, ...c2paResult.checks];
    const integrityFailures = [...exifResult.failures, ...c2paResult.failures];
    if (integrityChecks.length > 0) {
      console.error(`[integrity] ${queryId}: ${integrityChecks.join("; ")}`);
    }
    if (integrityFailures.length > 0) {
      console.error(`[integrity] ${queryId} warnings: ${integrityFailures.join("; ")}`);
    }

    return result;
  }
}

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
 * 1. Integrity validation (EXIF + C2PA on raw data)
 * 2. EXIF stripping (always)
 * 3. Blossom mirror (if configured)
 */
export function withPrivacyPipeline(store: AttachmentStore): AttachmentStore {
  let result: AttachmentStore = new ExifStrippingStore(store);
  result = new IntegrityValidationStore(result);
  if (isBlossomEnabled()) {
    result = new BlossomMirrorStore(result);
  }
  return result;
}
