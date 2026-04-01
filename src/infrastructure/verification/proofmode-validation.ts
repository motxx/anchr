/**
 * ProofMode zip validation: parse proof bundle and verify integrity.
 *
 * ProofMode bundles contain:
 * - Photo (JPG)
 * - proof.json (device metadata, GPS, timestamps)
 * - proof.csv (same data in CSV)
 * - .asc (PGP detached signatures)
 * - pubkey.asc (PGP public key)
 * - .devicecheck (Apple App Attest, CBOR)
 * - .ots (OpenTimestamps, Bitcoin blockchain proof)
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { spawn } from "../../runtime/mod.ts";

export interface ProofModeData {
  /** The extracted photo buffer. */
  photo: Buffer;
  /** Original photo filename. */
  photoFilename: string;
  /** Parsed proof.json metadata. */
  proof: ProofModeMetadata | null;
  /** Whether SHA256 hash in proof.json matches the actual photo hash. */
  hashValid: boolean;
  /** Whether PGP signature verification passed (null = gpg not available). */
  pgpValid: boolean | null;
  /** Whether OpenTimestamps proof exists. */
  hasOts: boolean;
  /** Whether Apple DeviceCheck attestation exists. */
  hasDeviceCheck: boolean;
  /** Validation checks (advisory). */
  checks: string[];
  /** Validation failures. */
  failures: string[];
}

export interface ProofModeMetadata {
  fileHashSha256: string;
  proofGenerated: string;
  manufacturer: string;
  hardware: string;
  screenSize: string;
  locationProvider: string;
  locationLatitude: number;
  locationLongitude: number;
  locationAccuracy: string;
  locationAltitude: number;
  locationSpeed: number;
  locationBearing: number;
  networkType: string;
  locale: string;
}

function parseProofJson(raw: string): ProofModeMetadata | null {
  try {
    const obj = JSON.parse(raw);
    return {
      fileHashSha256: obj["File Hash SHA256"] ?? "",
      proofGenerated: obj["Proof Generated"] ?? "",
      manufacturer: obj["Manufacturer"] ?? "",
      hardware: obj["Hardware"] ?? "",
      screenSize: obj["ScreenSize"] ?? "",
      locationProvider: obj["Location.Provider"] ?? "",
      locationLatitude: parseFloat(obj["Location.Latitude"]) || 0,
      locationLongitude: parseFloat(obj["Location.Longitude"]) || 0,
      locationAccuracy: obj["Location.Accuracy"] ?? "",
      locationAltitude: parseFloat(obj["Location.Altitude"]) || 0,
      locationSpeed: parseFloat(obj["Location.Speed"]) || -1,
      locationBearing: parseFloat(obj["Location.Bearing"]) || -1,
      networkType: obj["NetworkType"] ?? "",
      locale: obj["Locale"] ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Extract photo + proof data from a ProofMode zip buffer.
 */
export async function parseProofModeZip(zipBuffer: Buffer): Promise<ProofModeData | null> {
  const { unzipSync } = await import("node:zlib");

  // Use Bun's built-in zip support
  const entries = await extractZipEntries(zipBuffer);
  if (!entries) return null;

  const checks: string[] = [];
  const failures: string[] = [];

  // Find the photo file
  const photoEntry = Object.entries(entries).find(([name]) =>
    /\.(jpg|jpeg|png|heic|webp)$/i.test(name) && !name.startsWith("__MACOSX"),
  );
  if (!photoEntry) {
    return null; // No photo found in zip
  }
  const [photoFilename, photoBuffer] = photoEntry;
  checks.push(`ProofMode: photo found (${photoFilename})`);

  // Find proof.json
  const proofJsonEntry = Object.entries(entries).find(([name]) =>
    name.endsWith(".proof.json"),
  );
  let proof: ProofModeMetadata | null = null;
  let hashValid = false;

  if (proofJsonEntry) {
    proof = parseProofJson(proofJsonEntry[1].toString("utf-8"));
    if (proof) {
      checks.push(`ProofMode: proof.json parsed (${proof.manufacturer} ${proof.hardware})`);

      // Verify SHA256 hash
      const actualHash = bytesToHex(sha256(new Uint8Array(photoBuffer)));
      hashValid = actualHash === proof.fileHashSha256;
      if (hashValid) {
        checks.push("ProofMode: SHA256 hash matches");
      } else {
        failures.push(`ProofMode: SHA256 mismatch (expected ${proof.fileHashSha256.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...)`);
      }

      // GPS accuracy info
      if (proof.locationProvider && proof.locationLatitude !== 0) {
        const accuracy = proof.locationAccuracy.split(",")[0] || proof.locationAccuracy;
        checks.push(`ProofMode: GPS via ${proof.locationProvider} (accuracy: ${parseFloat(accuracy).toFixed(1)}m)`);
      }
    }
  } else {
    checks.push("ProofMode: no proof.json (partial bundle)");
  }

  // Check for PGP signature + key
  const hasAsc = Object.keys(entries).some((name) =>
    name.endsWith(".asc") && !name.includes("proof") && !name.includes("pubkey"),
  );
  const hasPubkey = Object.keys(entries).some((name) => name === "pubkey.asc");
  let pgpValid: boolean | null = null;

  if (hasAsc && hasPubkey) {
    pgpValid = await verifyPgpSignature(entries, photoFilename, photoBuffer);
    if (pgpValid === true) {
      checks.push("ProofMode: PGP signature valid");
    } else if (pgpValid === false) {
      failures.push("ProofMode: PGP signature invalid");
    } else {
      checks.push("ProofMode: PGP signature present (gpg not available for verification)");
    }
  }

  // Check for OpenTimestamps
  const hasOts = Object.keys(entries).some((name) => name.endsWith(".ots"));
  if (hasOts) {
    checks.push("ProofMode: OpenTimestamps proof present (Bitcoin anchored)");
  }

  // Check for DeviceCheck
  const hasDeviceCheck = Object.keys(entries).some((name) => name.endsWith(".devicecheck"));
  if (hasDeviceCheck) {
    checks.push("ProofMode: Apple DeviceCheck attestation present");
  }

  return {
    photo: photoBuffer,
    photoFilename,
    proof,
    hashValid,
    pgpValid,
    hasOts,
    hasDeviceCheck,
    checks,
    failures,
  };
}

/**
 * Extract all entries from a zip buffer using Bun's DeflateDecoder / raw zip parsing.
 */
async function extractZipEntries(zipBuffer: Buffer): Promise<Record<string, Buffer> | null> {
  try {
    // Use unzip via spawn for reliability
    const tmpDir = `/tmp/proofmode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });

    const zipPath = `${tmpDir}/input.zip`;
    writeFileSync(zipPath, zipBuffer);
    const proc = spawn(["unzip", "-o", "-q", "-d", tmpDir, zipPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    const entries: Record<string, Buffer> = {};
    function readDir(dir: string, prefix: string) {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = `${dir}/${item.name}`;
        const entryName = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
          if (item.name !== "__MACOSX") readDir(fullPath, entryName);
        } else {
          entries[item.name] = readFileSync(fullPath) as Buffer;
        }
      }
    }
    readDir(tmpDir, "");
    rmSync(tmpDir, { recursive: true, force: true });

    return Object.keys(entries).length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/**
 * Verify PGP detached signature using gpg CLI.
 */
async function verifyPgpSignature(
  entries: Record<string, Buffer>,
  photoFilename: string,
  photoBuffer: Buffer,
): Promise<boolean | null> {
  try {
    const { writeFileSync, rmSync, mkdirSync } = await import("node:fs");
    const tmpDir = `/tmp/pgp-verify-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });

    // Find the signature file for the photo
    const photoHash = bytesToHex(sha256(new Uint8Array(photoBuffer)));
    const sigFilename = Object.keys(entries).find((name) =>
      name === `${photoHash}.asc`,
    );
    if (!sigFilename) return null;

    const pubkeyData = entries["pubkey.asc"];
    if (!pubkeyData) return null;

    // Write files
    writeFileSync(`${tmpDir}/photo.jpg`, photoBuffer);
    writeFileSync(`${tmpDir}/photo.sig.asc`, entries[sigFilename]!);
    writeFileSync(`${tmpDir}/pubkey.asc`, pubkeyData);

    // Import key and verify
    const gpgHome = `${tmpDir}/gnupg`;
    mkdirSync(gpgHome, { mode: 0o700 });

    const importProc = spawn([
      "gpg", "--homedir", gpgHome, "--batch", "--yes", "--import", `${tmpDir}/pubkey.asc`,
    ], { stdout: "pipe", stderr: "pipe" });
    await importProc.exited;
    if (importProc.exitCode !== 0) {
      rmSync(tmpDir, { recursive: true, force: true });
      return null; // gpg not available or import failed
    }

    const verifyProc = spawn([
      "gpg", "--homedir", gpgHome, "--batch", "--verify",
      `${tmpDir}/photo.sig.asc`, `${tmpDir}/photo.jpg`,
    ], { stdout: "pipe", stderr: "pipe" });
    await verifyProc.exited;

    rmSync(tmpDir, { recursive: true, force: true });
    return verifyProc.exitCode === 0;
  } catch {
    return null;
  }
}
