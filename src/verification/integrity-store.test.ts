import { afterEach, describe, expect, test } from "bun:test";
import type { C2paValidationResult } from "./c2pa-validation";
import type { ExifValidationResult } from "./exif-validation";
import {
  clearIntegrityStore,
  getIntegrity,
  getIntegrityForQuery,
  purgeStaleIntegrity,
  storeIntegrity,
} from "./integrity-store";

const dummyExif: ExifValidationResult = {
  hasExif: true,
  hasCameraModel: true,
  hasTimestamp: true,
  hasGps: false,
  timestampRecent: true,
  gpsNearHint: null,
  metadata: { make: "Test", model: "Camera" },
  checks: ["EXIF present"],
  failures: [],
};

const dummyC2pa: C2paValidationResult = {
  available: false,
  hasManifest: false,
  signatureValid: false,
  manifest: null,
  checks: ["c2patool not installed"],
  failures: [],
};

afterEach(() => clearIntegrityStore());

describe("integrity store", () => {
  test("stores and retrieves by attachment ID", () => {
    storeIntegrity({ attachmentId: "photo1.jpg", queryId: "q1", capturedAt: Date.now(), exif: dummyExif, c2pa: dummyC2pa });

    const result = getIntegrity("photo1.jpg");
    expect(result).not.toBeNull();
    expect(result!.exif.hasCameraModel).toBe(true);
    expect(result!.queryId).toBe("q1");
  });

  test("returns null for unknown attachment", () => {
    expect(getIntegrity("nonexistent")).toBeNull();
  });

  test("retrieves by query ID", () => {
    storeIntegrity({ attachmentId: "a.jpg", queryId: "q2", capturedAt: Date.now(), exif: dummyExif, c2pa: dummyC2pa });
    storeIntegrity({ attachmentId: "b.jpg", queryId: "q2", capturedAt: Date.now(), exif: dummyExif, c2pa: dummyC2pa });
    storeIntegrity({ attachmentId: "c.jpg", queryId: "q3", capturedAt: Date.now(), exif: dummyExif, c2pa: dummyC2pa });

    expect(getIntegrityForQuery("q2")).toHaveLength(2);
    expect(getIntegrityForQuery("q3")).toHaveLength(1);
    expect(getIntegrityForQuery("q99")).toHaveLength(0);
  });

  test("purges stale entries", () => {
    storeIntegrity({ attachmentId: "old.jpg", queryId: "q1", capturedAt: Date.now() - 10_000_000, exif: dummyExif, c2pa: dummyC2pa });
    storeIntegrity({ attachmentId: "new.jpg", queryId: "q2", capturedAt: Date.now(), exif: dummyExif, c2pa: dummyC2pa });

    const purged = purgeStaleIntegrity(7_200_000);
    expect(purged).toBe(1);
    expect(getIntegrity("old.jpg")).toBeNull();
    expect(getIntegrity("new.jpg")).not.toBeNull();
  });
});
