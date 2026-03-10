import { extname, join } from "node:path";
import { DEFAULT_UPLOADS_DIR } from "./config";
import { stripExif } from "./exif-strip";
import { validateC2pa } from "./verification/c2pa-validation";
import { validateExif } from "./verification/exif-validation";
import { storeIntegrity } from "./verification/integrity-store";
import type { AttachmentRef } from "./types";

function sanitizeExt(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  return ext || ".bin";
}

/**
 * Upload an attachment: validate integrity → strip EXIF → save to disk.
 * Returns the stored AttachmentRef.
 */
export async function uploadAttachment(queryId: string, file: File): Promise<AttachmentRef> {
  const rawBuffer = Buffer.from(await file.arrayBuffer());

  // 1. Validate integrity on raw data (before any modification)
  const [exifResult, c2paResult] = await Promise.all([
    Promise.resolve(validateExif(rawBuffer)),
    validateC2pa(rawBuffer, file.name),
  ]);

  // 2. Strip EXIF (preserves C2PA/JUMBF)
  const stripped = await stripExif(rawBuffer, file.name);

  // 3. Save to disk
  const ext = sanitizeExt(file.name);
  const filename = `${queryId}_${Date.now()}${ext}`;
  const path = join(DEFAULT_UPLOADS_DIR, filename);
  await Bun.write(path, stripped);

  const routePath = `/uploads/${filename}`;
  const attachment: AttachmentRef = {
    id: filename,
    uri: routePath,
    mime_type: file.type || "application/octet-stream",
    storage_kind: "local",
    filename,
    size_bytes: stripped.length,
    local_file_path: path,
    route_path: routePath,
  };

  // 4. Store integrity metadata for verification
  storeIntegrity({
    attachmentId: attachment.id,
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

  return attachment;
}
