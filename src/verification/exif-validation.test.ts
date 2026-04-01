import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { extractExifMetadata, validateExif } from "./exif-validation";

// Minimal valid JPEG with EXIF APP1 segment containing Make, Model, DateTime
function buildJpegWithExif(options: {
  make?: string;
  model?: string;
  dateTime?: string;
  gps?: { lat: number; lon: number };
}): Buffer {
  // Build a minimal TIFF/EXIF structure inside a JPEG APP1 segment
  const le = true; // little-endian
  const entries: Array<{ tag: number; type: number; count: number; value: Buffer }> = [];

  function makeAsciiEntry(tag: number, str: string): void {
    const buf = Buffer.from(str + "\0", "ascii");
    entries.push({ tag, type: 2, count: buf.length, value: buf });
  }

  if (options.make) makeAsciiEntry(0x010f, options.make);
  if (options.model) makeAsciiEntry(0x0110, options.model);
  if (options.dateTime) makeAsciiEntry(0x0132, options.dateTime);

  // Calculate IFD size: 2 (count) + entries * 12 + 4 (next IFD)
  const ifdEntryCount = entries.length;
  const ifdHeaderSize = 2 + ifdEntryCount * 12 + 4;
  const ifdDataOffset = 8 + ifdHeaderSize; // 8 = TIFF header

  // Build TIFF data
  const tiffParts: Buffer[] = [];

  // TIFF header: byte order + magic + IFD0 offset
  const tiffHeader = Buffer.alloc(8);
  tiffHeader.writeUInt16LE(0x4949, 0); // "II" little-endian
  tiffHeader.writeUInt16LE(42, 2);
  tiffHeader.writeUInt32LE(8, 4); // IFD0 at offset 8
  tiffParts.push(tiffHeader);

  // IFD0
  const ifdBuf = Buffer.alloc(ifdHeaderSize);
  ifdBuf.writeUInt16LE(ifdEntryCount, 0);

  let dataPos = ifdDataOffset;
  const dataParts: Buffer[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const entryOffset = 2 + i * 12;
    ifdBuf.writeUInt16LE(entry.tag, entryOffset);
    ifdBuf.writeUInt16LE(entry.type, entryOffset + 2);
    ifdBuf.writeUInt32LE(entry.count, entryOffset + 4);

    if (entry.value.length <= 4) {
      entry.value.copy(ifdBuf, entryOffset + 8);
    } else {
      ifdBuf.writeUInt32LE(dataPos, entryOffset + 8);
      dataParts.push(entry.value);
      dataPos += entry.value.length;
    }
  }

  // Next IFD = 0 (no more IFDs)
  ifdBuf.writeUInt32LE(0, 2 + ifdEntryCount * 12);
  tiffParts.push(ifdBuf);
  tiffParts.push(...dataParts);

  const tiffData = Buffer.concat(tiffParts);

  // Build JPEG APP1 segment
  const exifHeader = Buffer.from("Exif\0\0", "ascii");
  const app1Payload = Buffer.concat([exifHeader, tiffData]);
  const app1Length = app1Payload.length + 2; // +2 for length field itself

  const app1Segment = Buffer.alloc(4 + app1Payload.length);
  app1Segment.writeUInt16BE(0xffe1, 0);
  app1Segment.writeUInt16BE(app1Length, 2);
  app1Payload.copy(app1Segment, 4);

  // Minimal JPEG: SOI + APP1 + SOS + EOI
  const soi = Buffer.from([0xff, 0xd8]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02]); // minimal SOS
  const eoi = Buffer.from([0xff, 0xd9]);

  return Buffer.concat([soi, app1Segment, sos, eoi]);
}

describe("extractExifMetadata", () => {
  test("extracts make and model from JPEG EXIF", () => {
    const jpeg = buildJpegWithExif({ make: "Apple", model: "iPhone 15 Pro" });
    const meta = extractExifMetadata(jpeg);
    expect(meta.make).toBe("Apple");
    expect(meta.model).toBe("iPhone 15 Pro");
  });

  test("extracts dateTime", () => {
    const jpeg = buildJpegWithExif({ dateTime: "2026:03:10 14:30:00" });
    const meta = extractExifMetadata(jpeg);
    expect(meta.dateTime).toBe("2026:03:10 14:30:00");
  });

  test("returns empty for non-JPEG data", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const meta = extractExifMetadata(png);
    expect(meta.make).toBeUndefined();
    expect(meta.model).toBeUndefined();
  });

  test("returns empty for JPEG without EXIF", () => {
    const bare = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
    const meta = extractExifMetadata(bare);
    expect(meta.make).toBeUndefined();
  });
});

describe("validateExif", () => {
  test("passes for JPEG with camera model and recent timestamp", () => {
    const now = new Date();
    const dt = `${now.getFullYear()}:${String(now.getMonth() + 1).padStart(2, "0")}:${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const jpeg = buildJpegWithExif({ make: "Samsung", model: "Galaxy S24", dateTime: dt });
    const result = validateExif(jpeg);

    expect(result.hasExif).toBe(true);
    expect(result.hasCameraModel).toBe(true);
    expect(result.hasTimestamp).toBe(true);
    expect(result.timestampRecent).toBe(true);
    expect(result.failures).toEqual([]);
  });

  test("warns for missing EXIF (AI-generated indicator)", () => {
    const bare = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
    const result = validateExif(bare);

    expect(result.hasExif).toBe(false);
    expect(result.failures).toContain("no EXIF metadata found (possible AI-generated image)");
  });

  test("warns for old timestamp", () => {
    const jpeg = buildJpegWithExif({ make: "Canon", model: "EOS R5", dateTime: "2020:01:01 00:00:00" });
    const result = validateExif(jpeg);

    expect(result.hasExif).toBe(true);
    expect(result.hasCameraModel).toBe(true);
    expect(result.timestampRecent).toBe(false);
    expect(result.failures.some((f) => f.includes("not recent"))).toBe(true);
  });

  test("warns for missing camera model", () => {
    const jpeg = buildJpegWithExif({ dateTime: "2026:03:10 12:00:00" });
    const result = validateExif(jpeg);

    expect(result.hasExif).toBe(true);
    expect(result.hasCameraModel).toBe(false);
    expect(result.failures.some((f) => f.includes("no camera make/model"))).toBe(true);
  });
});
