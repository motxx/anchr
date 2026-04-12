import { Buffer } from "node:buffer";
import { checkAttachmentContent } from "./ai-content-check";
import { validateC2pa } from "./c2pa-validation";
import { haversineKm } from "./exif-validation";
import { getIntegrity, getIntegrityForQuery } from "./integrity-store";
import { validateTlsn } from "./tlsn-validation";
import { fetchBlossomAttachment } from "../blossom/fetch-attachment";
import { validateAttachmentUri } from "../url-validation";
import type {
  AttachmentRef,
  BlossomKeyMap,
  GpsCoord,
  Query,
  QueryResult,
  TlsnVerifiedData,
  VerificationDetail,
} from "../../domain/types";
/** Module-level seam for testing — matches _setVerifierPathForTest pattern. */
let _validateTlsnFn: typeof validateTlsn = validateTlsn;

/** Allow tests to override the validateTlsn implementation. Pass null to reset. */
export function _setValidateTlsnForTest(fn: typeof validateTlsn | null): void {
  _validateTlsnFn = fn ?? validateTlsn;
}

/** Default maximum distance (km) between reported GPS and expected GPS. */
const DEFAULT_MAX_GPS_DISTANCE_KM = 50;

/**
 * Verify a query result cryptographically.
 *
 * Oracle checks:
 * 1. Attachments present → C2PA / EXIF integrity
 * 2. AI content check (opt-in, if attachments pass crypto checks)
 * 3. No attachments → reject if bounty/GPS/nonce required, otherwise weak pass
 * 4. Body GPS vs expected GPS proximity check
 */
interface CheckAccumulator {
  checks: string[];
  failures: string[];
  warnings: string[];
}

function verifyEmptySubmission(
  query: Query,
  hasTlsn: boolean,
  acc: CheckAccumulator,
): void {
  const requiresEvidence =
    query.verification_requirements.includes("nonce") ||
    query.verification_requirements.includes("gps");

  if (requiresEvidence && !hasTlsn) {
    acc.failures.push("no media evidence provided — photos are required when GPS or nonce verification is enabled");
  } else if (!hasTlsn) {
    acc.checks.push("no media evidence provided (weak verification)");
  }
}

function verifyBodyGps(
  query: Query,
  result: QueryResult,
  maxGpsDist: number,
  acc: CheckAccumulator,
): void {
  if (result.gps && query.expected_gps) {
    const dist = haversineKm(result.gps.lat, result.gps.lon, query.expected_gps.lat, query.expected_gps.lon);
    if (dist <= maxGpsDist) {
      acc.checks.push(`body GPS within ${maxGpsDist}km of expected (${dist.toFixed(1)}km)`);
    } else {
      acc.failures.push(`body GPS ${dist.toFixed(1)}km from expected location (max ${maxGpsDist}km)`);
    }
  } else if (!result.gps && query.expected_gps && query.verification_requirements.includes("gps")) {
    acc.failures.push("GPS coordinates missing from submission body — required by verification policy");
  }
}

async function verifyTlsnExtensionResult(
  extResult: { presentation?: string; results?: Array<{ type: string; part: string; value: string }> },
  query: Query,
  acc: CheckAccumulator,
): Promise<TlsnVerifiedData | undefined> {
  if (extResult.presentation && query.tlsn_requirements) {
    const tlsnResult = await _validateTlsnFn(
      { presentation: extResult.presentation },
      query.tlsn_requirements,
    );
    acc.checks.push(...tlsnResult.checks);
    acc.failures.push(...tlsnResult.failures);
    return tlsnResult.verifiedData;
  } else if (!extResult.presentation) {
    acc.failures.push("TLSNotary extension: no cryptographic presentation included — self-reported data cannot be trusted");
  } else {
    acc.failures.push("TLSNotary extension: query missing tlsn_requirements");
  }
  return undefined;
}

async function verifyTlsnAttestation(
  result: QueryResult,
  query: Query,
  acc: CheckAccumulator,
): Promise<TlsnVerifiedData | undefined> {
  if (!result.tlsn_attestation) {
    acc.failures.push("TLSNotary: no attestation provided");
    return undefined;
  }
  if (!query.tlsn_requirements) {
    acc.failures.push("TLSNotary: query missing tlsn_requirements");
    return undefined;
  }
  const tlsnResult = await _validateTlsnFn(
    result.tlsn_attestation,
    query.tlsn_requirements,
  );
  acc.checks.push(...tlsnResult.checks);
  acc.failures.push(...tlsnResult.failures);
  return tlsnResult.verifiedData;
}

async function verifyTlsn(
  query: Query,
  result: QueryResult,
  acc: CheckAccumulator,
): Promise<TlsnVerifiedData | undefined> {
  if (result.tlsn_extension_result) {
    const extResult = result.tlsn_extension_result as {
      presentation?: string;
      results?: Array<{ type: string; part: string; value: string }>;
    };
    return verifyTlsnExtensionResult(extResult, query, acc);
  }
  return verifyTlsnAttestation(result, query, acc);
}

function applyAiContentResult(
  aiResult: { passed: boolean; reason: string } | null,
  acc: CheckAccumulator,
): void {
  if (!aiResult) return;
  if (aiResult.passed) {
    acc.checks.push(`AI content check passed: ${aiResult.reason}`);
  } else {
    // AI check is advisory (non-deterministic) — route to warnings, not failures
    acc.warnings.push(`AI content check failed: ${aiResult.reason}`);
  }
}

export async function verify(query: Query, result: QueryResult, blossomKeys?: BlossomKeyMap): Promise<VerificationDetail> {
  const acc: CheckAccumulator = { checks: [], failures: [], warnings: [] };
  let tlsnVerifiedData: TlsnVerifiedData | undefined;
  const maxGpsDist = query.max_gps_distance_km ?? DEFAULT_MAX_GPS_DISTANCE_KM;

  const attachments = result.attachments ?? [];
  const hasTlsn = query.verification_requirements.includes("tlsn");

  if (attachments.length === 0) {
    verifyEmptySubmission(query, hasTlsn, acc);
  }

  verifyBodyGps(query, result, maxGpsDist, acc);

  if (hasTlsn) {
    tlsnVerifiedData = await verifyTlsn(query, result, acc);
  }

  if (attachments.length > 0) {
    acc.checks.push("attachment present");
    await verifyPhotoIntegrity(query.id, attachments, acc.checks, acc.failures, query.expected_gps, maxGpsDist, blossomKeys);
  }

  if (attachments.length > 0 && acc.failures.length === 0) {
    applyAiContentResult(await checkAttachmentContent(query, result, blossomKeys), acc);
  }

  return {
    passed: acc.failures.length === 0,
    checks: acc.checks,
    failures: acc.failures,
    warnings: acc.warnings.length > 0 ? acc.warnings : undefined,
    tlsn_verified: tlsnVerifiedData,
  };
}

function checkC2paSignature(
  c2pa: { available: boolean; hasManifest: boolean; signatureValid: boolean },
  checks: string[],
  failures: string[],
): void {
  if (!c2pa.available) {
    failures.push("C2PA: c2patool not available — cannot verify Content Credentials");
  } else if (!c2pa.hasManifest) {
    failures.push("C2PA: no Content Credentials found — use a C2PA-enabled camera");
  } else if (c2pa.signatureValid) {
    checks.push("C2PA: valid Content Credentials signature");
  } else {
    failures.push("C2PA: Content Credentials signature invalid");
  }
}

function checkGpsProximity(
  gps: GpsCoord | undefined,
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  label: string,
  checks: string[],
  failures: string[],
): void {
  if (gps && expectedGps) {
    const dist = haversineKm(gps.lat, gps.lon, expectedGps.lat, expectedGps.lon);
    if (dist <= maxGpsDist) {
      checks.push(`${label} GPS within ${maxGpsDist}km of expected (${dist.toFixed(1)}km)`);
    } else {
      failures.push(`${label} GPS ${dist.toFixed(1)}km from expected location (max ${maxGpsDist}km)`);
    }
  } else if (gps) {
    checks.push(`${label} GPS: ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`);
  }
}

function checkProofModeRecord(
  proofmode: { checks: string[]; failures: string[]; proof: { locationLatitude: number; locationLongitude: number } | null } | undefined,
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  checks: string[],
  failures: string[],
): void {
  if (!proofmode) return;
  for (const c of proofmode.checks) checks.push(c);
  for (const f of proofmode.failures) failures.push(f);

  if (proofmode.proof && expectedGps && (proofmode.proof.locationLatitude !== 0 || proofmode.proof.locationLongitude !== 0)) {
    const gps = { lat: proofmode.proof.locationLatitude, lon: proofmode.proof.locationLongitude };
    checkGpsProximity(gps, expectedGps, maxGpsDist, "ProofMode", checks, failures);
  }
}

function checkExifRecord(
  exif: { hasExif: boolean; hasCameraModel: boolean; hasTimestamp: boolean; timestampRecent: boolean; hasGps: boolean; gpsNearHint: boolean | null; metadata: { make?: string; model?: string } },
  checks: string[],
  failures: string[],
): void {
  if (!exif.hasExif) {
    checks.push("EXIF: no metadata (stripped by worker for privacy)");
    return;
  }

  if (exif.hasCameraModel) {
    checks.push(`EXIF: camera identified (${[exif.metadata.make, exif.metadata.model].filter(Boolean).join(" ")})`);
  } else {
    checks.push("EXIF: present but no camera model (screenshot or processed image)");
  }

  if (exif.hasTimestamp) {
    checks.push(exif.timestampRecent ? "EXIF: timestamp is recent" : "EXIF: timestamp is not recent (older photo)");
  }

  if (exif.hasGps) {
    checks.push("EXIF: GPS coordinates present");
    if (exif.gpsNearHint === true) {
      checks.push("EXIF: GPS matches location hint");
    } else if (exif.gpsNearHint === false) {
      failures.push("EXIF: GPS coordinates far from expected location");
    }
  }
}

/**
 * Verify photo integrity using pre-strip EXIF and C2PA metadata.
 *
 * C2PA is mandatory — photos without valid Content Credentials are rejected.
 * EXIF checks are advisory (GPS, camera model add trust signals but don't fail).
 * C2PA GPS and ProofMode GPS are compared against expected_gps.
 */
async function verifyPhotoIntegrity(
  queryId: string,
  attachments: AttachmentRef[],
  checks: string[],
  failures: string[],
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  blossomKeys?: BlossomKeyMap,
): Promise<void> {
  // Try to find integrity data for attachments in this result
  const integrityRecords = attachments
    .map((att) => getIntegrity(att.id))
    .filter((m) => m !== null);

  // Also check by queryId for cases where attachment IDs differ
  if (integrityRecords.length === 0) {
    const byQuery = getIntegrityForQuery(queryId);
    if (byQuery.length > 0) {
      integrityRecords.push(...byQuery);
    }
  }

  // No pre-upload integrity data — try direct C2PA validation on attachments
  // This handles the decentralized path (Blossom download → C2PA check)
  if (integrityRecords.length === 0) {
    await verifyC2paFromAttachments(attachments, checks, failures, expectedGps, maxGpsDist, blossomKeys);
    return;
  }

  for (const record of integrityRecords) {
    checkC2paSignature(record.c2pa, checks, failures);
    checkGpsProximity(record.c2pa.gps, expectedGps, maxGpsDist, "C2PA", checks, failures);
    checkProofModeRecord(record.proofmode, expectedGps, maxGpsDist, checks, failures);
    checkExifRecord(record.exif, checks, failures);
  }
}

async function fetchAttachmentData(
  att: AttachmentRef,
  failures: string[],
  blossomKeys?: BlossomKeyMap,
): Promise<Uint8Array | null> {
  if (att.storage_kind === "blossom") {
    const keyMaterial = blossomKeys?.[att.id];
    const data = await fetchBlossomAttachment(att, keyMaterial);
    if (data) return data;
  }

  if (att.uri) {
    const uriError = validateAttachmentUri(att.uri);
    if (uriError) {
      failures.push(`C2PA: attachment URI rejected (${uriError})`);
      return null;
    }
    try {
      const response = await fetch(att.uri);
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
    } catch {
      // fetch failed
    }
  }

  return null;
}

async function verifyC2paFromAttachments(
  attachments: AttachmentRef[],
  checks: string[],
  failures: string[],
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  blossomKeys?: BlossomKeyMap,
): Promise<void> {
  if (attachments.length === 0) return;

  let validated = false;
  for (const att of attachments) {
    if (!att.mime_type?.startsWith("image/")) continue;

    const data = await fetchAttachmentData(att, failures, blossomKeys);
    if (!data) {
      failures.push("C2PA: could not retrieve attachment for verification");
      continue;
    }

    const filename = att.filename ?? att.id ?? "photo.jpg";
    const c2pa = await validateC2pa(Buffer.from(data), filename);

    checkC2paSignature(c2pa, checks, failures);
    checkGpsProximity(c2pa.gps, expectedGps, maxGpsDist, "C2PA", checks, failures);
    validated = true;
  }

  if (!validated && attachments.some((a) => a.mime_type?.startsWith("image/"))) {
    failures.push("C2PA: no image attachments could be verified");
  }
}
