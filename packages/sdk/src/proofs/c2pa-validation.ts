/**
 * C2PA (Content Credentials) validation via `c2patool` CLI.
 *
 * In production (Docker), c2patool is pre-installed in the image.
 * In local development, gracefully skipped if not on PATH.
 * EXIF validation + handwritten nonce provide coverage without C2PA.
 */

import type { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, which, writeFile } from "../internal/runtime/mod.ts";
import { evaluateGpsDistancePolicy } from "./geo.ts";

import { getLogger } from "../internal/runtime/logger.ts";
const log = getLogger(["anchr", "c2pa"]);

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

export interface C2paGpsBindingPolicy {
  expectedGps: { lat: number; lon: number };
  maxDistanceKm: number;
}

export interface C2paGpsBindingResult {
  passed: boolean;
  distanceKm?: number;
  checks: string[];
  failures: string[];
}

export interface C2paToolOptions {
  /**
   * Override c2patool discovery: an explicit binary path, or null to force
   * the tool-unavailable behavior. Defaults to PATH discovery (cached).
   */
  toolPath?: string | null;
}

let c2paToolPath: string | null | undefined;

function findC2paTool(override?: string | null): string | null {
  if (override !== undefined) return override;
  if (c2paToolPath !== undefined) return c2paToolPath;
  c2paToolPath = which("c2patool");
  if (c2paToolPath) {
    log.debug(`Found c2patool at ${c2paToolPath}`);
  }
  return c2paToolPath ?? null;
}

export function isC2paAvailable(options?: C2paToolOptions): boolean {
  return findC2paTool(options?.toolPath) !== null;
}

export function verifyC2paGpsBinding(
  validation: C2paValidationResult,
  policy: C2paGpsBindingPolicy,
): C2paGpsBindingResult {
  const checks: string[] = [];
  const failures: string[] = [];

  if (!Number.isFinite(policy.maxDistanceKm) || policy.maxDistanceKm < 0) {
    return {
      passed: false,
      checks,
      failures: ["C2PA GPS binding policy has an invalid distance limit"],
    };
  }

  if (!validation.available) {
    failures.push(
      "C2PA: verifier unavailable — cannot bind signed GPS to expected location",
    );
  } else if (!validation.hasManifest) {
    failures.push(
      "C2PA: no signed manifest found — cannot bind GPS to expected location",
    );
  } else if (!validation.signatureValid) {
    failures.push(
      "C2PA: manifest signature invalid — cannot trust GPS assertion",
    );
  } else {
    checks.push("C2PA: signed manifest verified");
  }

  if (!validation.gps) {
    failures.push(
      "C2PA: signed GPS assertion missing from verified manifest",
    );
    return { passed: false, checks, failures };
  }

  const { distanceKm, withinLimit } = evaluateGpsDistancePolicy(
    validation.gps,
    policy.expectedGps,
    policy.maxDistanceKm,
  );

  if (failures.length > 0) {
    return { passed: false, distanceKm, checks, failures };
  }

  if (withinLimit) {
    checks.push(
      `C2PA: signed GPS bound to expected location (${
        distanceKm.toFixed(1)
      }km <= ${policy.maxDistanceKm}km)`,
    );
  } else {
    failures.push(
      `C2PA: signed GPS ${distanceKm.toFixed(1)}km from expected location ` +
        `(max ${policy.maxDistanceKm}km)`,
    );
  }

  return {
    passed: failures.length === 0,
    distanceKm,
    checks,
    failures,
  };
}

const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".mp4",
  ".mov",
]);

function noToolResult(): C2paValidationResult {
  return {
    available: false,
    hasManifest: false,
    signatureValid: false,
    manifest: null,
    checks: ["c2patool not available (skipped)"],
    failures: [],
  };
}

function noManifestResult(
  checks: string[],
  failures: string[],
): C2paValidationResult {
  return {
    available: true,
    hasManifest: false,
    signatureValid: false,
    manifest: null,
    checks,
    failures,
  };
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
    if (
      stderrLower.includes("no claim found") ||
      stderrLower.includes("manifestnotfound") ||
      stderrLower.includes("no manifest")
    ) {
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
): {
  active: Record<string, unknown>;
  rawAssertions?: Array<{ label: string; data?: Record<string, unknown> }>;
} | null {
  const manifests = report.manifests as
    | Record<string, Record<string, unknown>>
    | undefined;
  const activeManifestLabel = report.active_manifest as string | undefined;
  if (!manifests || !activeManifestLabel || !manifests[activeManifestLabel]) {
    return null;
  }

  const active = manifests[activeManifestLabel]!;
  const rawAssertions = active.assertions as
    | Array<{ label: string; data?: Record<string, unknown> }>
    | undefined;
  return { active, rawAssertions };
}

function buildManifest(
  active: Record<string, unknown>,
  rawAssertions?: Array<{ label: string; data?: Record<string, unknown> }>,
): C2paManifest {
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

/**
 * Failure codes that do not invalidate the signature. INV-06 requires this
 * evaluation to fail closed: any failure entry in the c2patool validation
 * report (tampered assertion store, untrusted credential, broken data hash,
 * …) invalidates the signature unless its code is allowlisted here as
 * informational. Currently empty on purpose — no known c2patool failure
 * code is safe to ignore for GPS binding.
 */
const IGNORABLE_FAILURE_CODES: ReadonlySet<string> = new Set();

export function evaluateSignature(report: Record<string, unknown>): boolean {
  const validationResults = report.validation_results as {
    activeManifest?: {
      success?: Array<{ code: string }>;
      failure?: Array<{ code: string; explanation?: string }>;
    };
  } | undefined;
  const successCodes = validationResults?.activeManifest?.success ?? [];
  const failureCodes = validationResults?.activeManifest?.failure ?? [];

  const claimSignatureOk = successCodes.some((v) =>
    v.code === "claimSignature.validated"
  );
  const realFailures = failureCodes.filter((v) =>
    !IGNORABLE_FAILURE_CODES.has(v.code)
  );
  return claimSignatureOk && realFailures.length === 0;
}

export async function validateC2pa(
  data: Buffer,
  filename: string,
  options?: C2paToolOptions,
): Promise<C2paValidationResult> {
  const checks: string[] = [];
  const failures: string[] = [];
  const toolPath = findC2paTool(options?.toolPath);

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
    if (manifest.claimGenerator) {
      checks.push(`claim generator: ${manifest.claimGenerator}`);
    }
    if (manifest.signatureInfo?.issuer) {
      checks.push(`signer: ${manifest.signatureInfo.issuer}`);
    }
    if (manifest.signatureInfo?.time) {
      checks.push(`signed at: ${manifest.signatureInfo.time}`);
    }

    if (signatureValid) {
      checks.push("C2PA signature valid");
    } else {
      failures.push("C2PA signature validation failed");
    }

    const gps = extractC2paGps(parsed.rawAssertions);
    if (gps) {
      checks.push(
        `C2PA EXIF GPS: ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`,
      );
    }

    return {
      available: true,
      hasManifest: true,
      signatureValid,
      manifest,
      gps: gps ?? undefined,
      checks,
      failures,
    };
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

function applyGpsDirection(
  value: number,
  ref: unknown,
  raw: unknown,
  negativeChar: string,
): number {
  if (typeof ref === "string" && ref.toUpperCase().startsWith(negativeChar)) {
    return -value;
  }
  if (
    typeof raw === "string" && new RegExp(`${negativeChar}$`, "i").test(raw)
  ) return -Math.abs(value);
  return value;
}

function extractC2paGps(
  assertions?: Array<{ label: string; data?: Record<string, unknown> }>,
): { lat: number; lon: number } | null {
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

    if (finalLat !== 0 || finalLon !== 0) {
      return { lat: finalLat, lon: finalLon };
    }
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
