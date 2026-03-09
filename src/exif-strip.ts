/**
 * EXIF metadata stripping for uploaded images.
 *
 * Removes GPS coordinates, device info, timestamps, and other
 * privacy-sensitive EXIF data from JPEG files before storage.
 * For non-JPEG formats, uses sips/magick if available.
 */

const JPEG_SOI = 0xffd8;
const JPEG_APP1 = 0xffe1;
const JPEG_SOS = 0xffda;

/**
 * Strip EXIF from JPEG by removing APP1 (Exif) segments.
 * Preserves image quality — no re-encoding.
 */
function stripJpegExif(data: Buffer): Buffer {
  if (data.length < 2) return data;
  if (data.readUInt16BE(0) !== JPEG_SOI) return data;

  const chunks: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;

  while (offset < data.length - 1) {
    const marker = data.readUInt16BE(offset);

    // Start of scan — rest is image data, copy verbatim
    if (marker === JPEG_SOS) {
      chunks.push(data.subarray(offset));
      break;
    }

    // Not a marker
    if ((marker & 0xff00) !== 0xff00) {
      chunks.push(data.subarray(offset));
      break;
    }

    // Markers without length (standalone)
    if (marker >= 0xffd0 && marker <= 0xffd9) {
      chunks.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 3 >= data.length) {
      chunks.push(data.subarray(offset));
      break;
    }

    const segmentLength = data.readUInt16BE(offset + 2);
    const segmentEnd = offset + 2 + segmentLength;

    if (marker === JPEG_APP1) {
      // Check if this is EXIF (starts with "Exif\0\0") or XMP
      const payloadStart = offset + 4;
      const isExif =
        data.length > payloadStart + 5 &&
        data[payloadStart] === 0x45 && // E
        data[payloadStart + 1] === 0x78 && // x
        data[payloadStart + 2] === 0x69 && // i
        data[payloadStart + 3] === 0x66; // f

      const isXmp =
        data.length > payloadStart + 28 &&
        data.subarray(payloadStart, payloadStart + 28).toString("ascii").startsWith("http://ns.adobe.com/xap");

      if (isExif || isXmp) {
        // Skip this segment (strip it)
        offset = segmentEnd;
        continue;
      }
    }

    chunks.push(data.subarray(offset, segmentEnd));
    offset = segmentEnd;
  }

  return Buffer.concat(chunks);
}

/**
 * Strip EXIF using external tools (for non-JPEG formats like PNG, HEIC, WebP).
 * Falls back to returning original data if no tool available.
 */
async function stripExifWithTool(data: Buffer, ext: string): Promise<Buffer> {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  // Try magick (ImageMagick) first, then sips on macOS
  const magick = Bun.which("magick");
  const sips = process.platform === "darwin" ? "/usr/bin/sips" : null;

  if (!magick && !sips) {
    return data;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "gt-exif-strip-"));
  const inputPath = join(tempDir, `input${ext}`);
  const outputPath = join(tempDir, `output${ext}`);

  try {
    await Bun.write(inputPath, data);

    let proc: ReturnType<typeof Bun.spawn>;
    if (magick) {
      proc = Bun.spawn([magick, inputPath, "-strip", outputPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
    } else {
      // sips can only strip in-place for some formats
      const { copyFile } = await import("node:fs/promises");
      await copyFile(inputPath, outputPath);
      proc = Bun.spawn([sips!, "-d", "allExif", outputPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
    }

    await proc.exited;
    if (proc.exitCode !== 0) {
      return data;
    }

    const outputFile = Bun.file(outputPath);
    if (await outputFile.exists()) {
      return Buffer.from(await outputFile.arrayBuffer());
    }
    return data;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

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
