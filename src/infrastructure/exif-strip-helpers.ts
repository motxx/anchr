/**
 * EXIF stripping helpers: JPEG segment parsing and external tool execution.
 */

import { Buffer } from "node:buffer";
import { spawn, which, writeFile, fileExists, readFileAsArrayBuffer } from "../runtime/mod.ts";

const JPEG_SOI = 0xffd8;
const JPEG_APP1 = 0xffe1;
const JPEG_SOS = 0xffda;

function isExifSegment(data: Buffer, payloadStart: number): boolean {
  return (
    data.length > payloadStart + 5 &&
    data[payloadStart] === 0x45 && // E
    data[payloadStart + 1] === 0x78 && // x
    data[payloadStart + 2] === 0x69 && // i
    data[payloadStart + 3] === 0x66    // f
  );
}

function isXmpSegment(data: Buffer, payloadStart: number): boolean {
  return (
    data.length > payloadStart + 28 &&
    data.subarray(payloadStart, payloadStart + 28).toString("ascii").startsWith("http://ns.adobe.com/xap")
  );
}

function isStandaloneMarker(marker: number): boolean {
  return marker >= 0xffd0 && marker <= 0xffd9;
}

/**
 * Strip EXIF from JPEG by removing APP1 (Exif/XMP) segments.
 * Preserves C2PA/JUMBF (APP11) and image quality — no re-encoding.
 */
export function stripJpegExif(data: Buffer): Buffer {
  if (data.length < 2) return data;
  if (data.readUInt16BE(0) !== JPEG_SOI) return data;

  const chunks: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;

  while (offset < data.length - 1) {
    const marker = data.readUInt16BE(offset);

    if (marker === JPEG_SOS) {
      chunks.push(data.subarray(offset));
      break;
    }

    if ((marker & 0xff00) !== 0xff00) {
      chunks.push(data.subarray(offset));
      break;
    }

    if (isStandaloneMarker(marker)) {
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
      const payloadStart = offset + 4;
      if (isExifSegment(data, payloadStart) || isXmpSegment(data, payloadStart)) {
        offset = segmentEnd;
        continue;
      }
    }

    chunks.push(data.subarray(offset, segmentEnd));
    offset = segmentEnd;
  }

  return Buffer.concat(chunks);
}

async function stripWithExiftool(inputPath: string, outputPath: string): Promise<boolean> {
  const exiftool = which("exiftool");
  if (!exiftool) return false;

  const { copyFile } = await import("node:fs/promises");
  await copyFile(inputPath, outputPath);
  const proc = spawn([exiftool, "-all=", "--jumbf:all", "-overwrite_original", outputPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  return proc.exitCode === 0 && await fileExists(outputPath);
}

async function stripWithFallbackTool(inputPath: string, outputPath: string): Promise<boolean> {
  const magick = which("magick");
  const sips = process.platform === "darwin" ? "/usr/bin/sips" : null;

  if (!magick && !sips) return false;

  let proc: ReturnType<typeof spawn>;
  if (magick) {
    proc = spawn([magick, inputPath, "-strip", outputPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } else {
    const { copyFile } = await import("node:fs/promises");
    await copyFile(inputPath, outputPath);
    proc = spawn([sips!, "-d", "allExif", outputPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  await proc.exited;
  return proc.exitCode === 0 && await fileExists(outputPath);
}

/**
 * Strip EXIF using exiftool (preserves C2PA/JUMBF), falling back to
 * ImageMagick/sips (which destroy C2PA). Returns original data if no tool.
 */
export async function stripExifWithTool(data: Buffer, ext: string): Promise<Buffer> {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const tempDir = await mkdtemp(join(tmpdir(), "anchr-exif-strip-"));
  const inputPath = join(tempDir, `input${ext}`);
  const outputPath = join(tempDir, `output${ext}`);

  try {
    await writeFile(inputPath, data);

    if (await stripWithExiftool(inputPath, outputPath)) {
      return Buffer.from(await readFileAsArrayBuffer(outputPath));
    }

    if (await stripWithFallbackTool(inputPath, outputPath)) {
      return Buffer.from(await readFileAsArrayBuffer(outputPath));
    }

    return data;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
