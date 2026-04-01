import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { parseProofModeZip } from "./proofmode-validation";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function minimalJpeg(): Buffer {
  return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x02, 0xFF, 0xD9]);
}

/**
 * Create a ProofMode-style zip with photo + proof.json.
 * Throws if `zip` CLI is unavailable (test should fail, not skip silently).
 */
function createProofModeZip(opts?: {
  correctHash?: boolean;
  includeOts?: boolean;
  includeDeviceCheck?: boolean;
}): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "pm-test-"));

  try {
    const photo = minimalJpeg();
    const photoName = "photo.jpg";
    writeFileSync(join(dir, photoName), photo);

    const actualHash = bytesToHex(sha256(new Uint8Array(photo)));
    const hash = opts?.correctHash !== false ? actualHash : "0000000000000000000000000000000000000000000000000000000000000000";

    const proofJson = {
      "File Hash SHA256": hash,
      "Proof Generated": new Date().toISOString(),
      "Manufacturer": "TestDevice",
      "Hardware": "TestHW",
      "ScreenSize": "1080x1920",
      "Location.Provider": "gps",
      "Location.Latitude": "35.6762",
      "Location.Longitude": "139.6503",
      "Location.Accuracy": "10.0",
      "Location.Altitude": "40.0",
      "Location.Speed": "-1",
      "Location.Bearing": "-1",
      "NetworkType": "wifi",
      "Locale": "ja_JP",
    };

    writeFileSync(join(dir, `${photoName}.proof.json`), JSON.stringify(proofJson));

    if (opts?.includeOts) {
      writeFileSync(join(dir, `${photoName}.ots`), "fake-ots-data");
    }
    if (opts?.includeDeviceCheck) {
      writeFileSync(join(dir, `${photoName}.devicecheck`), "fake-cbor");
    }

    const zipPath = join(dir, "bundle.zip");
    execSync(`zip -j -q ${zipPath} ${dir}/*`, { cwd: dir });
    return readFileSync(zipPath) as Buffer;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("parseProofModeZip", () => {
  test("parses valid ProofMode zip with correct hash", async () => {
    const zip = createProofModeZip({ correctHash: true });
    const result = await parseProofModeZip(zip);

    expect(result).not.toBeNull();
    expect(result!.photo).toBeInstanceOf(Buffer);
    expect(result!.photo.length).toBeGreaterThan(0);
    expect(result!.photoFilename).toContain(".jpg");
    expect(result!.proof).not.toBeNull();
    expect(result!.proof!.manufacturer).toBe("TestDevice");
    expect(result!.proof!.locationLatitude).toBeCloseTo(35.6762, 2);
    expect(result!.proof!.locationLongitude).toBeCloseTo(139.6503, 2);
    expect(result!.hashValid).toBe(true);
    expect(result!.checks.length).toBeGreaterThan(0);
    expect(result!.failures.length).toBe(0);
  });

  test("detects SHA256 hash mismatch", async () => {
    const zip = createProofModeZip({ correctHash: false });
    const result = await parseProofModeZip(zip);

    expect(result).not.toBeNull();
    expect(result!.hashValid).toBe(false);
    expect(result!.failures.some((f) => f.includes("SHA256 mismatch"))).toBe(true);
  });

  test("detects OpenTimestamps presence", async () => {
    const zip = createProofModeZip({ includeOts: true });
    const result = await parseProofModeZip(zip);

    expect(result).not.toBeNull();
    expect(result!.hasOts).toBe(true);
    expect(result!.checks.some((c) => c.includes("OpenTimestamps"))).toBe(true);
  });

  test("detects DeviceCheck presence", async () => {
    const zip = createProofModeZip({ includeDeviceCheck: true });
    const result = await parseProofModeZip(zip);

    expect(result).not.toBeNull();
    expect(result!.hasDeviceCheck).toBe(true);
    expect(result!.checks.some((c) => c.includes("DeviceCheck"))).toBe(true);
  });

  test("returns null for non-zip buffer", async () => {
    const result = await parseProofModeZip(Buffer.from("not a zip file"));
    expect(result).toBeNull();
  });

  test("returns null for zip without photo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-nophoto-"));
    try {
      writeFileSync(join(dir, "readme.txt"), "no photo here");
      const zipPath = join(dir, "bundle.zip");
      execSync(`zip -j -q ${zipPath} ${dir}/readme.txt`, { cwd: dir });
      const zip = readFileSync(zipPath) as Buffer;
      const result = await parseProofModeZip(zip);
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
