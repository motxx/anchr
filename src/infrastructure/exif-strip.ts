/**
 * EXIF metadata stripping for uploaded images.
 *
 * Removes GPS coordinates, device info, timestamps, and other
 * privacy-sensitive EXIF data from JPEG files before storage.
 * For non-JPEG formats, uses sips/magick if available.
 */

import { Buffer } from "node:buffer";
import { stripJpegExif, stripExifWithTool } from "./exif-strip-helpers";

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif",
]);

/**
 * Strip EXIF/metadata from an image buffer.
 * JPEG: Pure JS implementation (no re-encoding, lossless).
 * Other formats: Uses ImageMagick/sips if available.
 * Non-image files are returned unchanged.
 */
export async function stripExif(data: Buffer, filename: string): Promise<Buffer> {
  const ext = filename.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";

  if (!IMAGE_EXTENSIONS.has(ext)) {
    return data;
  }

  if (ext === ".jpg" || ext === ".jpeg") {
    return stripJpegExif(data);
  }

  return stripExifWithTool(data, ext);
}
