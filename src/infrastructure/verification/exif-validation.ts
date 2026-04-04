/**
 * EXIF pre-validation: extract metadata from images BEFORE stripping.
 *
 * Checks camera model presence, timestamp recency, and GPS proximity
 * to detect AI-generated images (which lack real EXIF data).
 */

import { Buffer } from "node:buffer";
import { haversineKm } from "../../domain/geo";

const JPEG_SOI = 0xffd8;
const JPEG_APP1 = 0xffe1;

// IFD0 tags
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;

// ExifIFD tags
const TAG_DATETIME_ORIGINAL = 0x9003;

// GPS tags
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LON_REF = 0x0003;
const TAG_GPS_LON = 0x0004;

// EXIF types
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

export interface ExifMetadata {
  make?: string;
  model?: string;
  dateTime?: string;
  dateTimeOriginal?: string;
  gps?: { lat: number; lon: number };
}

export interface ExifValidationResult {
  hasExif: boolean;
  hasCameraModel: boolean;
  hasTimestamp: boolean;
  hasGps: boolean;
  timestampRecent: boolean;
  gpsNearHint: boolean | null;
  metadata: ExifMetadata;
  checks: string[];
  failures: string[];
}

function readU16(buf: Buffer, offset: number, le: boolean): number {
  return le ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
}

function readU32(buf: Buffer, offset: number, le: boolean): number {
  return le ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
}

function readAscii(buf: Buffer, tiffBase: number, offset: number, count: number): string {
  const start = tiffBase + offset;
  if (start + count > buf.length) return "";
  return buf.subarray(start, start + count).toString("ascii").replace(/\0+$/, "");
}

function readRational(buf: Buffer, tiffBase: number, offset: number, le: boolean): number {
  const pos = tiffBase + offset;
  if (pos + 8 > buf.length) return 0;
  const num = readU32(buf, pos, le);
  const den = readU32(buf, pos + 4, le);
  return den === 0 ? 0 : num / den;
}

function readGpsCoord(buf: Buffer, tiffBase: number, offset: number, le: boolean): number {
  const deg = readRational(buf, tiffBase, offset, le);
  const min = readRational(buf, tiffBase, offset + 8, le);
  const sec = readRational(buf, tiffBase, offset + 16, le);
  return deg + min / 60 + sec / 3600;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
}

function readIfdEntries(buf: Buffer, tiffBase: number, ifdOffset: number, le: boolean): IfdEntry[] {
  const pos = tiffBase + ifdOffset;
  if (pos + 2 > buf.length) return [];
  const count = readU16(buf, pos, le);
  const entries: IfdEntry[] = [];
  for (let i = 0; i < count; i++) {
    const entryPos = pos + 2 + i * 12;
    if (entryPos + 12 > buf.length) break;
    entries.push({
      tag: readU16(buf, entryPos, le),
      type: readU16(buf, entryPos + 2, le),
      count: readU32(buf, entryPos + 4, le),
      valueOffset: readU32(buf, entryPos + 8, le),
    });
  }
  return entries;
}

function getEntryStringValue(buf: Buffer, tiffBase: number, entry: IfdEntry, le: boolean): string {
  if (entry.type !== TYPE_ASCII) return "";
  if (entry.count <= 4) {
    // Value stored inline in the valueOffset field
    const inlinePos = tiffBase + entry.count; // Not right for inline
    // For inline ASCII, re-read from the entry position
    return readAscii(buf, 0, tiffBase + readIfdEntryValuePos(buf, tiffBase, entry, le), entry.count);
  }
  return readAscii(buf, tiffBase, entry.valueOffset, entry.count);
}

function readIfdEntryValuePos(_buf: Buffer, _tiffBase: number, entry: IfdEntry, _le: boolean): number {
  // If data fits in 4 bytes, it's stored inline at the value field position
  // But since we're using the offset from the entry, for strings > 4 bytes it's a pointer
  return entry.valueOffset;
}

function getEntryLong(entry: IfdEntry, le: boolean, buf: Buffer, tiffBase: number): number {
  if (entry.type === TYPE_LONG) {
    return entry.valueOffset;
  }
  if (entry.type === TYPE_SHORT) {
    return entry.valueOffset & (le ? 0xffff : 0xffff0000 >> 16);
  }
  return readU32(buf, tiffBase + entry.valueOffset, le);
}

function findApp1ExifSegment(data: Buffer): { tiffBase: number; tiffData: Buffer } | null {
  if (data.length < 2 || data.readUInt16BE(0) !== JPEG_SOI) return null;

  let offset = 2;
  while (offset < data.length - 3) {
    const marker = data.readUInt16BE(offset);
    if ((marker & 0xff00) !== 0xff00) break;
    if (marker >= 0xffd0 && marker <= 0xffd9) { offset += 2; continue; }

    const segLen = data.readUInt16BE(offset + 2);
    if (marker === JPEG_APP1) {
      const payloadStart = offset + 4;
      if (
        data.length > payloadStart + 6 &&
        data[payloadStart] === 0x45 && // E
        data[payloadStart + 1] === 0x78 && // x
        data[payloadStart + 2] === 0x69 && // i
        data[payloadStart + 3] === 0x66 && // f
        data[payloadStart + 4] === 0x00 &&
        data[payloadStart + 5] === 0x00
      ) {
        const tiffBase = payloadStart + 6;
        return { tiffBase, tiffData: data.subarray(tiffBase) };
      }
    }
    offset += 2 + segLen;
  }
  return null;
}

function entryAsciiOffset(ifdOffset: number, entries: IfdEntry[], entry: IfdEntry): number {
  return entry.count <= 4
    ? ifdOffset + 2 + entries.indexOf(entry) * 12 + 8
    : entry.valueOffset;
}

function parseExifIfd(buf: Buffer, tiffBase: number, entry: IfdEntry, le: boolean): string | undefined {
  const exifIfdOffset = getEntryLong(entry, le, buf, tiffBase);
  const exifEntries = readIfdEntries(buf, tiffBase, exifIfdOffset, le);
  for (const exifEntry of exifEntries) {
    if (exifEntry.tag === TAG_DATETIME_ORIGINAL) {
      return readAscii(buf, tiffBase, entryAsciiOffset(exifIfdOffset, exifEntries, exifEntry), exifEntry.count);
    }
  }
  return undefined;
}

function parseGpsIfd(buf: Buffer, tiffBase: number, entry: IfdEntry, le: boolean): { lat: number; lon: number } | undefined {
  const gpsIfdOffset = getEntryLong(entry, le, buf, tiffBase);
  const gpsEntries = readIfdEntries(buf, tiffBase, gpsIfdOffset, le);
  let latRef = "N";
  let lonRef = "E";
  let lat = 0;
  let lon = 0;
  let hasLat = false;
  let hasLon = false;
  for (const gpsEntry of gpsEntries) {
    switch (gpsEntry.tag) {
      case TAG_GPS_LAT_REF:
        latRef = readAscii(buf, tiffBase, entryAsciiOffset(gpsIfdOffset, gpsEntries, gpsEntry), gpsEntry.count);
        break;
      case TAG_GPS_LAT:
        if (gpsEntry.type === TYPE_RATIONAL && gpsEntry.count === 3) {
          lat = readGpsCoord(buf, tiffBase, gpsEntry.valueOffset, le);
          hasLat = true;
        }
        break;
      case TAG_GPS_LON_REF:
        lonRef = readAscii(buf, tiffBase, entryAsciiOffset(gpsIfdOffset, gpsEntries, gpsEntry), gpsEntry.count);
        break;
      case TAG_GPS_LON:
        if (gpsEntry.type === TYPE_RATIONAL && gpsEntry.count === 3) {
          lon = readGpsCoord(buf, tiffBase, gpsEntry.valueOffset, le);
          hasLon = true;
        }
        break;
    }
  }
  if (hasLat && hasLon) {
    return {
      lat: latRef.startsWith("S") ? -lat : lat,
      lon: lonRef.startsWith("W") ? -lon : lon,
    };
  }
  return undefined;
}

export function extractExifMetadata(data: Buffer): ExifMetadata {
  const exifSeg = findApp1ExifSegment(data);
  if (!exifSeg) return {};

  const { tiffBase, tiffData } = exifSeg;
  if (tiffData.length < 8) return {};

  const byteOrder = tiffData.readUInt16BE(0);
  const le = byteOrder === 0x4949;
  if (!le && byteOrder !== 0x4d4d) return {};

  const magic = readU16(tiffData, 2, le);
  if (magic !== 42) return {};

  const ifd0Offset = readU32(tiffData, 4, le);
  const buf = data;
  const entries = readIfdEntries(buf, tiffBase, ifd0Offset, le);

  const metadata: ExifMetadata = {};

  for (const entry of entries) {
    switch (entry.tag) {
      case TAG_MAKE:
        metadata.make = readAscii(buf, tiffBase, entryAsciiOffset(ifd0Offset, entries, entry), entry.count);
        break;
      case TAG_MODEL:
        metadata.model = readAscii(buf, tiffBase, entryAsciiOffset(ifd0Offset, entries, entry), entry.count);
        break;
      case TAG_DATETIME:
        metadata.dateTime = readAscii(buf, tiffBase, entryAsciiOffset(ifd0Offset, entries, entry), entry.count);
        break;
      case TAG_EXIF_IFD:
        metadata.dateTimeOriginal = parseExifIfd(buf, tiffBase, entry, le);
        break;
      case TAG_GPS_IFD:
        metadata.gps = parseGpsIfd(buf, tiffBase, entry, le);
        break;
    }
  }

  return metadata;
}

function parseExifDateTime(dt: string): Date | null {
  // Format: "YYYY:MM:DD HH:MM:SS"
  const match = dt.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`);
}

// Re-export from domain layer for backward compatibility
export { haversineKm } from "../../domain/geo";

export interface ExifValidationOptions {
  /** Max allowed age of photo timestamp in ms (default: 1 hour) */
  maxAgeMs?: number;
  /** Expected GPS coordinate for proximity check */
  expectedGps?: { lat: number; lon: number };
  /** Max distance from expected GPS in km (default: 50) */
  maxDistanceKm?: number;
  /** Reference time for recency check (default: Date.now()) */
  referenceTime?: number;
}

function validateCameraModel(
  metadata: ExifMetadata,
  checks: string[],
  failures: string[],
): boolean {
  const hasCameraModel = !!(metadata.make || metadata.model);
  if (hasCameraModel) {
    checks.push(`camera: ${[metadata.make, metadata.model].filter(Boolean).join(" ")}`);
  } else {
    failures.push("no camera make/model in EXIF (possible AI-generated or screenshot)");
  }
  return hasCameraModel;
}

function validateTimestamp(
  metadata: ExifMetadata,
  options: ExifValidationOptions | undefined,
  checks: string[],
  failures: string[],
): { hasTimestamp: boolean; timestampRecent: boolean } {
  const dtStr = metadata.dateTimeOriginal || metadata.dateTime;
  if (!dtStr) {
    failures.push("no timestamp in EXIF");
    return { hasTimestamp: false, timestampRecent: false };
  }

  const dt = parseExifDateTime(dtStr);
  if (!dt) {
    failures.push(`unparseable EXIF timestamp: ${dtStr}`);
    return { hasTimestamp: true, timestampRecent: false };
  }

  const refTime = options?.referenceTime ?? Date.now();
  const maxAge = options?.maxAgeMs ?? 3_600_000;
  const ageMs = refTime - dt.getTime();
  const timestampRecent = ageMs >= 0 && ageMs <= maxAge;
  if (timestampRecent) {
    checks.push(`timestamp recent: ${dtStr}`);
  } else {
    failures.push(`timestamp not recent: ${dtStr} (age: ${Math.round(ageMs / 60_000)}min)`);
  }
  return { hasTimestamp: true, timestampRecent };
}

function validateGps(
  metadata: ExifMetadata,
  options: ExifValidationOptions | undefined,
  checks: string[],
  failures: string[],
): { hasGps: boolean; gpsNearHint: boolean | null } {
  if (!metadata.gps) return { hasGps: false, gpsNearHint: null };

  checks.push(`GPS: ${metadata.gps.lat.toFixed(4)}, ${metadata.gps.lon.toFixed(4)}`);
  let gpsNearHint: boolean | null = null;

  if (options?.expectedGps) {
    const dist = haversineKm(metadata.gps.lat, metadata.gps.lon, options.expectedGps.lat, options.expectedGps.lon);
    const maxDist = options.maxDistanceKm ?? 50;
    gpsNearHint = dist <= maxDist;
    if (gpsNearHint) {
      checks.push(`GPS within ${maxDist}km of hint (${dist.toFixed(1)}km)`);
    } else {
      failures.push(`GPS ${dist.toFixed(1)}km from hint (max ${maxDist}km)`);
    }
  }
  return { hasGps: true, gpsNearHint };
}

export function validateExif(data: Buffer, options?: ExifValidationOptions): ExifValidationResult {
  const checks: string[] = [];
  const failures: string[] = [];

  const metadata = extractExifMetadata(data);
  const hasExif = !!(metadata.make || metadata.model || metadata.dateTime || metadata.gps);

  if (!hasExif) {
    failures.push("no EXIF metadata found (possible AI-generated image)");
    return { hasExif, hasCameraModel: false, hasTimestamp: false, hasGps: false, timestampRecent: false, gpsNearHint: null, metadata, checks, failures };
  }
  checks.push("EXIF metadata present");

  const hasCameraModel = validateCameraModel(metadata, checks, failures);
  const { hasTimestamp, timestampRecent } = validateTimestamp(metadata, options, checks, failures);
  const { hasGps, gpsNearHint } = validateGps(metadata, options, checks, failures);

  return { hasExif, hasCameraModel, hasTimestamp, hasGps, timestampRecent, gpsNearHint, metadata, checks, failures };
}
