import { Buffer } from "node:buffer";
import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { stripExif } from "./exif-strip";

/**
 * Build a minimal JPEG with an EXIF APP1 segment containing GPS-like data.
 */
function buildJpegWithExif(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]); // Start of Image

  // APP1 EXIF segment: marker(2) + length(2) + "Exif\0\0"(6) + fake TIFF data
  const exifHeader = Buffer.from("Exif\0\0", "ascii");
  const fakeTiffData = Buffer.alloc(32, 0x42); // dummy GPS/device data
  const app1Payload = Buffer.concat([exifHeader, fakeTiffData]);
  const app1Length = Buffer.alloc(2);
  app1Length.writeUInt16BE(app1Payload.length + 2);
  const app1Marker = Buffer.from([0xff, 0xe1]);
  const app1 = Buffer.concat([app1Marker, app1Length, app1Payload]);

  // APP0 JFIF segment (should be preserved)
  const jfifData = Buffer.from("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00", "binary");
  const app0Length = Buffer.alloc(2);
  app0Length.writeUInt16BE(jfifData.length + 2);
  const app0Marker = Buffer.from([0xff, 0xe0]);
  const app0 = Buffer.concat([app0Marker, app0Length, jfifData]);

  // SOS + minimal scan data + EOI
  const sos = Buffer.from([0xff, 0xda]);
  const sosLength = Buffer.alloc(2);
  sosLength.writeUInt16BE(4);
  const sosPayload = Buffer.from([0x00, 0x00]); // minimal
  const imageData = Buffer.from([0x00, 0x00, 0x00]); // fake compressed data
  const eoi = Buffer.from([0xff, 0xd9]);

  return Buffer.concat([soi, app0, app1, sos, sosLength, sosPayload, imageData, eoi]);
}

describe("EXIF stripping", () => {
  test("strips EXIF APP1 segment from JPEG", async () => {
    const jpegWithExif = buildJpegWithExif();

    // Verify EXIF is present before stripping
    expect(jpegWithExif.includes(Buffer.from("Exif"))).toBe(true);

    const stripped = await stripExif(jpegWithExif, "photo.jpg");

    // EXIF should be removed
    expect(stripped.includes(Buffer.from("Exif"))).toBe(false);

    // SOI marker should be preserved
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);

    // APP0 (JFIF) should be preserved
    expect(stripped.includes(Buffer.from("JFIF"))).toBe(true);

    // Should be smaller (EXIF segment removed)
    expect(stripped.length).toBeLessThan(jpegWithExif.length);
  });

  test("preserves non-JPEG files unchanged", async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await stripExif(pngData, "image.mp4");
    expect(result).toEqual(pngData);
  });

  test("handles empty buffer", async () => {
    const empty = Buffer.alloc(0);
    const result = await stripExif(empty, "empty.jpg");
    expect(result.length).toBe(0);
  });

  test("handles non-JPEG data with .jpg extension", async () => {
    const notJpeg = Buffer.from("not a jpeg");
    const result = await stripExif(notJpeg, "fake.jpg");
    // Should return unchanged since SOI marker doesn't match
    expect(result).toEqual(notJpeg);
  });

  test("handles JPEG with no EXIF", async () => {
    // Minimal JPEG: SOI + SOS + data + EOI
    const soi = Buffer.from([0xff, 0xd8]);
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00]);
    const data = Buffer.from([0x42, 0x42]);
    const eoi = Buffer.from([0xff, 0xd9]);
    const jpeg = Buffer.concat([soi, sos, data, eoi]);

    const result = await stripExif(jpeg, "no-exif.jpg");
    expect(result.length).toBe(jpeg.length);
  });
});
