/**
 * Single owner of filename → MIME inference. Upload and access paths must
 * agree on a file's MIME type, so both delegate here.
 */

import { extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function inferMimeTypeFromFilename(filename: string): string {
  return MIME_TYPES[extname(filename).toLowerCase()] ??
    "application/octet-stream";
}
