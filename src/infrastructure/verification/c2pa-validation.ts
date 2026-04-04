/**
 * C2PA (Content Credentials) validation via `c2patool` CLI.
 *
 * In production (Docker), c2patool is pre-installed in the image.
 * In local development, gracefully skipped if not on PATH.
 * EXIF validation + handwritten nonce provide coverage without C2PA.
 */

import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { which, writeFile, spawn } from "../../runtime/mod.ts";

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

function noToolResult(): C2paValidationResult {
  return { available: false, hasManifest: false, signatureValid: false, manifest: null, checks: ["c2patool not available (skipped)"], failures: [] };
}

function noManifestResult(checks: string[], failures: string[]): C2paValidationResult {
  return { available: true, hasManifest: false, signatureValid: false, manifest: null, checks, failures };
}

async function runC2paTool(
  toolPath: string,
  inputPath: string,
  checks: string[],
  failures: string[],
): Promise<Record<string, unknown> | null> {
  const proc = spawn([toolPath, inputPath], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    const stderrLower = stderr.toLowerCase();
    if (stderrLower.includes("no claim found") || stderrLower.includes("manifestnotfound") || stderrLower.includes("no manifest")) {
      checks.push("no C2PA manifest found");
      return null;
    }
    failures.push(`c2patool error: ${stderr.trim().slice(0, 200)}`);
    return null;
  }

  const stdout = await new Response(proc.stdout).text();
  try {
    return JSON.parse(stdout);
  } catch {
    failures.push("failed to parse c2patool JSON output");
    return null;
  }
}

function parseActiveManifest(
  report: Record<string, unknown>,
): { active: Record<string, unknown>; rawAssertions?: Array<{ label: string; data?: Record<string, unknown> }> } | null {
  const manifests = report.manifests as Record<string, Record<string, unknown>> | undefined;
  const activeManifestLabel = report.active_manifest as string | undefined;
  if (!manifests || !activeManifestLabel || !manifests[activeManifestLabel]) return null;

  const active = manifests[activeManifestLabel]!;
  const rawAssertions = active.assertions as Array<{ label: string; data?: Record<string, unknown> }> | undefined;
  return { active, rawAssertions };
}

function buildManifest(active: Record<string, unknown>, rawAssertions?: Array<{ label: string; data?: Record<string, unknown> }>): C2paManifest {
  const manifest: C2paManifest = {
    title: active.title as string | undefined,
    claimGenerator: active.claim_generator as string | undefined,
  };
  if (rawAssertions) manifest.assertions = rawAssertions;

  const sigInfo = active.signature_info as Record<string, unknown> | undefined;
  if (sigInfo) {
    manifest.signatureInfo = {
      issuer: sigInfo.issuer as string | undefined,
      time: sigInfo.time as string | undefined,
    };
  }
  return manifest;
}

function evaluateSignature(report: Record<string, unknown>): boolean {
  const validationResults = report.validation_results as {
    activeManifest?: { success?: Array<{ code: string }>; failure?: Array<{ code: string; explanation?: string }> };
  } | undefined;
  const successCodes = validationResults?.activeManifest?.success ?? [];
  const failureCodes = validationResults?.activeManifest?.failure ?? [];

  const claimSignatureOk = successCodes.some((v) => v.code === "claimSignature.validated");
  const hasRealFailures = failureCodes.some((v) =>
    v.code.startsWith("claimSignature.") || v.code.startsWith("assertion.dataHash."),
  );
  return claimSignatureOk && !hasRealFailures;
}

export async function validateC2pa(data: Buffer, filename: string): Promise<C2paValidationResult> {
  const checks: string[] = [];
  const failures: string[] = [];
  const toolPath = findC2paTool();

  if (!toolPath) return noToolResult();

  const ext = (filename.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return noManifestResult([`unsupported format for C2PA: ${ext}`], failures);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "anchr-c2pa-"));
  const inputPath = join(tempDir, `input${ext}`);

  try {
    await writeFile(inputPath, data);

    const report = await runC2paTool(toolPath, inputPath, checks, failures);
    if (!report) return noManifestResult(checks, failures);

    const parsed = parseActiveManifest(report);
    if (!parsed) {
      checks.push("C2PA data present but no active manifest");
      return noManifestResult(checks, failures);
    }

    const manifest = buildManifest(parsed.active, parsed.rawAssertions);
    const signatureValid = evaluateSignature(report);

    checks.push("C2PA manifest found");
    if (manifest.claimGenerator) checks.push(`claim generator: ${manifest.claimGenerator}`);
    if (manifest.signatureInfo?.issuer) checks.push(`signer: ${manifest.signatureInfo.issuer}`);
    if (manifest.signatureInfo?.time) checks.push(`signed at: ${manifest.signatureInfo.time}`);

    if (signatureValid) {
      checks.push("C2PA signature valid");
    } else {
      failures.push("C2PA signature validation failed");
    }

    const gps = extractC2paGps(parsed.rawAssertions);
    if (gps) checks.push(`C2PA EXIF GPS: ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`);

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
const GPS_KEY_PREFIXES = ["EXIF:", "exif:", "@exif:"];

function lookupGpsKeys(data: Record<string, unknown>, field: string): unknown {
  for (const prefix of GPS_KEY_PREFIXES) {
    const val = data[`${prefix}${field}`];
    if (val != null) return val;
  }
  return undefined;
}

function applyGpsDirection(value: number, ref: unknown, raw: unknown, negativeChar: string): number {
  if (typeof ref === "string" && ref.toUpperCase().startsWith(negativeChar)) return -value;
  if (typeof raw === "string" && new RegExp(`${negativeChar}$`, "i").test(raw)) return -Math.abs(value);
  return value;
}

function extractC2paGps(assertions?: Array<{ label: string; data?: Record<string, unknown> }>): { lat: number; lon: number } | null {
  if (!assertions) return null;

  for (const assertion of assertions) {
    if (!assertion.label.includes("exif") || !assertion.data) continue;

    const data = assertion.data;
    const latRaw = lookupGpsKeys(data, "GPSLatitude");
    const lonRaw = lookupGpsKeys(data, "GPSLongitude");
    if (latRaw == null || lonRaw == null) continue;

    const lat = parseGpsValue(latRaw);
    const lon = parseGpsValue(lonRaw);
    if (lat == null || lon == null) continue;

    const latRef = lookupGpsKeys(data, "GPSLatitudeRef");
    const lonRef = lookupGpsKeys(data, "GPSLongitudeRef");

    const finalLat = applyGpsDirection(lat, latRef, latRaw, "S");
    const finalLon = applyGpsDirection(lon, lonRef, lonRaw, "W");

    if (finalLat !== 0 || finalLon !== 0) return { lat: finalLat, lon: finalLon };
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
