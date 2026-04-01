/**
 * C2PA (Content Credentials) validation via `c2patool` CLI.
 *
 * In production (Docker), c2patool is pre-installed in the image.
 * In local development, gracefully skipped if not on PATH.
 * EXIF validation + handwritten nonce provide coverage without C2PA.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { which, writeFile, spawn } from "../runtime/mod.ts";

export interface C2paManifest {
  title?: string;
  claimGenerator?: string;
  signatureInfo?: {
    issuer?: string;
    time?: string;
  };
  assertions?: Array<{
    label: string;
    data?: Record<string, unknown>;
  }>;
}

export interface C2paValidationResult {
  available: boolean;
  hasManifest: boolean;
  signatureValid: boolean;
  manifest: C2paManifest | null;
  /** GPS coordinates extracted from C2PA EXIF assertion (cryptographically signed). */
  gps?: { lat: number; lon: number };
  checks: string[];
  failures: string[];
}

let c2paToolPath: string | null | undefined;

function findC2paTool(): string | null {
  if (c2paToolPath !== undefined) return c2paToolPath;
  c2paToolPath = which("c2patool");
  if (c2paToolPath) {
    console.error(`[c2pa] Found c2patool at ${c2paToolPath}`);
  }
  return c2paToolPath;
}

export function isC2paAvailable(): boolean {
  return findC2paTool() !== null;
}

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".mp4", ".mov"]);

export async function validateC2pa(data: Buffer, filename: string): Promise<C2paValidationResult> {
  const checks: string[] = [];
  const failures: string[] = [];
  const toolPath = findC2paTool();

  if (!toolPath) {
    return { available: false, hasManifest: false, signatureValid: false, manifest: null, checks: ["c2patool not available (skipped)"], failures };
  }

  const ext = (filename.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return { available: true, hasManifest: false, signatureValid: false, manifest: null, checks: [`unsupported format for C2PA: ${ext}`], failures };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "anchr-c2pa-"));
  const inputPath = join(tempDir, `input${ext}`);

  try {
    await writeFile(inputPath, data);

    const proc = spawn([toolPath, inputPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      const stderrLower = stderr.toLowerCase();
      if (stderrLower.includes("no claim found") || stderrLower.includes("manifestnotfound") || stderrLower.includes("no manifest")) {
        checks.push("no C2PA manifest found");
        return { available: true, hasManifest: false, signatureValid: false, manifest: null, checks, failures };
      }
      failures.push(`c2patool error: ${stderr.trim().slice(0, 200)}`);
      return { available: true, hasManifest: false, signatureValid: false, manifest: null, checks, failures };
    }

    const stdout = await new Response(proc.stdout).text();
    let report: Record<string, unknown>;
    try {
      report = JSON.parse(stdout);
    } catch {
      failures.push("failed to parse c2patool JSON output");
      return { available: true, hasManifest: false, signatureValid: false, manifest: null, checks, failures };
    }

    const manifests = report.manifests as Record<string, Record<string, unknown>> | undefined;
    const activeManifestLabel = report.active_manifest as string | undefined;

    if (!manifests || !activeManifestLabel || !manifests[activeManifestLabel]) {
      checks.push("C2PA data present but no active manifest");
      return { available: true, hasManifest: false, signatureValid: false, manifest: null, checks, failures };
    }

    const active = manifests[activeManifestLabel]!;
    const manifest: C2paManifest = {
      title: active.title as string | undefined,
      claimGenerator: active.claim_generator as string | undefined,
    };

    // Extract assertions (including EXIF GPS)
    const rawAssertions = active.assertions as Array<{ label: string; data?: Record<string, unknown> }> | undefined;
    if (rawAssertions) {
      manifest.assertions = rawAssertions;
    }

    const sigInfo = active.signature_info as Record<string, unknown> | undefined;
    if (sigInfo) {
      manifest.signatureInfo = {
        issuer: sigInfo.issuer as string | undefined,
        time: sigInfo.time as string | undefined,
      };
    }

    // c2patool puts validation results at report.validation_results (not inside the manifest).
    // validation_results.activeManifest has structured success/failure arrays.
    const validationResults = report.validation_results as {
      activeManifest?: { success?: Array<{ code: string }>; failure?: Array<{ code: string; explanation?: string }> };
    } | undefined;
    const successCodes = validationResults?.activeManifest?.success ?? [];
    const failureCodes = validationResults?.activeManifest?.failure ?? [];

    // Signature is valid if claimSignature.validated is in success list.
    // signingCredential.untrusted is expected for dev/self-signed certs and not a signature failure.
    const claimSignatureOk = successCodes.some((v) => v.code === "claimSignature.validated");
    const hasRealFailures = failureCodes.some((v) =>
      v.code.startsWith("claimSignature.") || v.code.startsWith("assertion.dataHash."),
    );
    const signatureValid = claimSignatureOk && !hasRealFailures;

    checks.push("C2PA manifest found");
    if (manifest.claimGenerator) checks.push(`claim generator: ${manifest.claimGenerator}`);
    if (manifest.signatureInfo?.issuer) checks.push(`signer: ${manifest.signatureInfo.issuer}`);
    if (manifest.signatureInfo?.time) checks.push(`signed at: ${manifest.signatureInfo.time}`);

    if (signatureValid) {
      checks.push("C2PA signature valid");
    } else {
      failures.push("C2PA signature validation failed");
    }

    // Extract GPS from C2PA EXIF assertion (cryptographically signed coordinates)
    const gps = extractC2paGps(rawAssertions);
    if (gps) {
      checks.push(`C2PA EXIF GPS: ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`);
    }

    return { available: true, hasManifest: true, signatureValid, manifest, gps: gps ?? undefined, checks, failures };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Extract GPS coordinates from C2PA EXIF assertion.
 *
 * c2patool outputs assertions like:
 * { label: "stds.exif", data: { "EXIF:GPSLatitude": "35.6762", "EXIF:GPSLongitude": "139.6503", ... } }
 * or with the @exif prefix:
 * { label: "stds.exif", data: { "@exif:GPSLatitude": "35,40.572N", ... } }
 */
function extractC2paGps(assertions?: Array<{ label: string; data?: Record<string, unknown> }>): { lat: number; lon: number } | null {
  if (!assertions) return null;

  for (const assertion of assertions) {
    if (!assertion.label.includes("exif") || !assertion.data) continue;

    const data = assertion.data;

    // Try multiple key formats c2patool may use
    const latRaw = data["EXIF:GPSLatitude"] ?? data["exif:GPSLatitude"] ?? data["@exif:GPSLatitude"];
    const lonRaw = data["EXIF:GPSLongitude"] ?? data["exif:GPSLongitude"] ?? data["@exif:GPSLongitude"];
    const latRef = data["EXIF:GPSLatitudeRef"] ?? data["exif:GPSLatitudeRef"] ?? data["@exif:GPSLatitudeRef"];
    const lonRef = data["EXIF:GPSLongitudeRef"] ?? data["exif:GPSLongitudeRef"] ?? data["@exif:GPSLongitudeRef"];

    if (latRaw == null || lonRaw == null) continue;

    let lat = parseGpsValue(latRaw);
    let lon = parseGpsValue(lonRaw);
    if (lat == null || lon == null) continue;

    // Apply reference direction
    if (typeof latRef === "string" && latRef.toUpperCase().startsWith("S")) lat = -lat;
    if (typeof lonRef === "string" && lonRef.toUpperCase().startsWith("W")) lon = -lon;

    // Some formats embed direction in the value string itself
    if (typeof latRaw === "string" && /S$/i.test(latRaw)) lat = -Math.abs(lat);
    if (typeof lonRaw === "string" && /W$/i.test(lonRaw)) lon = -Math.abs(lon);

    if (lat !== 0 || lon !== 0) return { lat, lon };
  }

  return null;
}

/**
 * Parse GPS coordinate value from various c2patool output formats:
 * - "35.6762" (decimal degrees)
 * - "35,40.572N" (degrees,decimal-minutes with direction suffix)
 * - "35,40,34.3" (degrees,minutes,seconds)
 */
function parseGpsValue(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;

  // Strip direction suffix for parsing
  const cleaned = raw.replace(/[NSEW]$/i, "").trim();

  // Decimal degrees
  const decimal = parseFloat(cleaned);
  if (!cleaned.includes(",") && Number.isFinite(decimal)) return decimal;

  // Degrees,minutes or degrees,minutes,seconds
  const parts = cleaned.split(",").map((s) => parseFloat(s.trim()));
  if (parts.some((p) => !Number.isFinite(p))) return null;

  if (parts.length === 2) {
    // degrees, decimal-minutes
    return parts[0]! + parts[1]! / 60;
  }
  if (parts.length === 3) {
    // degrees, minutes, seconds
    return parts[0]! + parts[1]! / 60 + parts[2]! / 3600;
  }

  return null;
}
