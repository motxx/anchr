import { Buffer } from "node:buffer";
import {
  type AiContentChecker,
  createAiContentChecker,
} from "../ai-content-check.ts";
import { validateC2pa } from "../c2pa-validation.ts";
import { haversineKm } from "../geo.ts";
import { getIntegrity, getIntegrityForRequest } from "../integrity-store.ts";
import { validateTlsn } from "../tlsn-validation.ts";
import { fetchBlossomAttachment } from "../../attachments/fetch-attachment.ts";
import { validateAttachmentUri } from "../../attachments/url-validation.ts";
import type {
  AttachmentRef,
  BlossomKeyMap,
  GpsCoord,
  Query as VerifiableRequest,
  QueryResult as RequestSubmissionResult,
  TlsnVerifiedData,
  VerificationDetail,
  VerificationInput,
  VerificationRequirement,
} from "../../requests/domain/types.ts";

let _validateTlsnFn: typeof validateTlsn = validateTlsn;

export const checkAttachmentContent: AiContentChecker<AttachmentRef> =
  createAiContentChecker<AttachmentRef>({
    getConfig: () => {
      const enabled = Deno.env.get("AI_CONTENT_CHECK");
      const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
      return {
        enabled: enabled === "true" || enabled === "1",
        anthropicApiKey: anthropicApiKey === "" ? undefined : anthropicApiKey,
      };
    },
    readAttachment: async (ref, blossomKey) => {
      const data = await fetchAttachmentData(
        ref,
        [],
        blossomKey ? { [ref.id]: blossomKey } : undefined,
      );
      if (!data) return null;
      return { data: Buffer.from(data), mimeType: ref.mime_type };
    },
  });

/** Allow tests to override the validateTlsn implementation. Pass null to reset. */
export function _setValidateTlsnForTest(fn: typeof validateTlsn | null): void {
  _validateTlsnFn = fn ?? validateTlsn;
}

const DEFAULT_MAX_GPS_DISTANCE_KM = 50;

interface CheckAccumulator {
  checks: string[];
  failures: string[];
  warnings: string[];
}

function verifyEmptySubmission(
  factors: readonly string[],
  hasTlsn: boolean,
  acc: CheckAccumulator,
): void {
  const requiresEvidence = factors.includes("nonce") || factors.includes("gps");

  if (requiresEvidence && !hasTlsn) {
    acc.failures.push(
      "no media evidence provided — photos are required when GPS or nonce verification is enabled",
    );
  } else if (!hasTlsn) {
    acc.checks.push("no media evidence provided (weak verification)");
  }
}

function verifyBodyGps(
  requirement: VerificationRequirement,
  input: VerificationInput,
  maxGpsDist: number,
  acc: CheckAccumulator,
): void {
  if (input.gps && requirement.expected_gps) {
    const dist = haversineKm(
      input.gps.lat,
      input.gps.lon,
      requirement.expected_gps.lat,
      requirement.expected_gps.lon,
    );
    if (dist <= maxGpsDist) {
      acc.checks.push(
        `body GPS within ${maxGpsDist}km of expected (${dist.toFixed(1)}km)`,
      );
    } else {
      acc.failures.push(
        `body GPS ${
          dist.toFixed(1)
        }km from expected location (max ${maxGpsDist}km)`,
      );
    }
  } else if (
    !input.gps && requirement.expected_gps &&
    requirement.factors.includes("gps")
  ) {
    acc.failures.push(
      "GPS coordinates missing from submission body — required by verification policy",
    );
  }
}

async function verifyTlsnExtensionResult(
  extResult: {
    presentation?: string;
    results?: Array<{ type: string; part: string; value: string }>;
  },
  requirement: VerificationRequirement,
  acc: CheckAccumulator,
): Promise<TlsnVerifiedData | undefined> {
  if (extResult.presentation && requirement.tlsn_requirements) {
    const tlsnResult = await _validateTlsnFn(
      { presentation: extResult.presentation },
      requirement.tlsn_requirements,
    );
    acc.checks.push(...tlsnResult.checks);
    acc.failures.push(...tlsnResult.failures);
    return tlsnResult.verifiedData;
  } else if (!extResult.presentation) {
    acc.failures.push(
      "TLSNotary extension: no cryptographic presentation included — self-reported data cannot be trusted",
    );
  } else {
    acc.failures.push("TLSNotary extension: query missing tlsn_requirements");
  }
  return undefined;
}

async function verifyTlsnAttestation(
  input: VerificationInput,
  requirement: VerificationRequirement,
  acc: CheckAccumulator,
): Promise<TlsnVerifiedData | undefined> {
  if (!input.tlsn_attestation) {
    acc.failures.push("TLSNotary: no attestation provided");
    return undefined;
  }
  if (!requirement.tlsn_requirements) {
    acc.failures.push("TLSNotary: query missing tlsn_requirements");
    return undefined;
  }
  const tlsnResult = await _validateTlsnFn(
    input.tlsn_attestation,
    requirement.tlsn_requirements,
  );
  acc.checks.push(...tlsnResult.checks);
  acc.failures.push(...tlsnResult.failures);
  return tlsnResult.verifiedData;
}

async function verifyTlsn(
  requirement: VerificationRequirement,
  input: VerificationInput,
  acc: CheckAccumulator,
): Promise<TlsnVerifiedData | undefined> {
  if (input.tlsn_extension_result) {
    const extResult = input.tlsn_extension_result as {
      presentation?: string;
      results?: Array<{ type: string; part: string; value: string }>;
    };
    return verifyTlsnExtensionResult(extResult, requirement, acc);
  }
  return verifyTlsnAttestation(input, requirement, acc);
}

function applyAiContentResult(
  aiResult: { passed: boolean; reason: string } | null,
  acc: CheckAccumulator,
): void {
  if (!aiResult) return;
  if (aiResult.passed) {
    acc.checks.push(`AI content check passed: ${aiResult.reason}`);
  } else {
    acc.warnings.push(`AI content check failed: ${aiResult.reason}`);
  }
}

/**
 * Pure, transport-neutral verification. Takes an explicit policy (`requirement`)
 * and evidence (`input`) instead of a request/result pair, so it can be
 * called directly from any host.
 *
 * The host orchestrator is responsible for the *trust envelope* around this
 * call: who signed the requirement, replay protection, deadline enforcement.
 * This function only answers "does the evidence satisfy the policy".
 */
export async function verifyProof(
  requirement: VerificationRequirement,
  input: VerificationInput,
  options?: { blossomKeys?: BlossomKeyMap },
): Promise<VerificationDetail> {
  const acc: CheckAccumulator = { checks: [], failures: [], warnings: [] };
  let tlsnVerifiedData: TlsnVerifiedData | undefined;
  const maxGpsDist = requirement.max_gps_distance_km ??
    DEFAULT_MAX_GPS_DISTANCE_KM;

  const attachments = input.attachments ?? [];
  const hasTlsn = requirement.factors.includes("tlsn");

  if (attachments.length === 0) {
    verifyEmptySubmission(requirement.factors, hasTlsn, acc);
  }

  verifyBodyGps(requirement, input, maxGpsDist, acc);

  if (hasTlsn) {
    tlsnVerifiedData = await verifyTlsn(requirement, input, acc);
  }

  if (attachments.length > 0) {
    acc.checks.push("attachment present");
    await verifyPhotoIntegrity(
      requirement.id,
      attachments,
      acc.checks,
      acc.failures,
      requirement.expected_gps,
      maxGpsDist,
      options?.blossomKeys,
    );
  }

  if (attachments.length > 0 && acc.failures.length === 0) {
    const aiQuery = {
      description: requirement.description ?? "",
      challenge_nonce: requirement.challenge_nonce,
      verification_requirements: requirement.factors,
    };
    const aiResult = await checkAttachmentContent(
      aiQuery,
      { attachments },
      options?.blossomKeys,
    );
    applyAiContentResult(aiResult, acc);
  }

  return {
    passed: acc.failures.length === 0,
    checks: acc.checks,
    failures: acc.failures,
    warnings: acc.warnings.length > 0 ? acc.warnings : undefined,
    tlsn_verified: tlsnVerifiedData,
  };
}

export function requestToRequirement(
  request: VerifiableRequest,
): VerificationRequirement {
  return {
    id: request.id,
    factors: request.verification_requirements,
    description: request.description,
    challenge_nonce: request.challenge_nonce,
    expected_gps: request.expected_gps,
    max_gps_distance_km: request.max_gps_distance_km,
    tlsn_requirements: request.tlsn_requirements,
  };
}

export function resultToVerificationInput(
  result: RequestSubmissionResult,
): VerificationInput {
  return {
    attachments: result.attachments,
    gps: result.gps,
    tlsn_attestation: result.tlsn_attestation,
    tlsn_extension_result: result.tlsn_extension_result,
  };
}

/**
 * NIP-90 adapters can use this shape. Standalone callers should construct a
 * `VerificationRequirement` directly and call `verifyProof`.
 */
export function verify(
  request: VerifiableRequest,
  result: RequestSubmissionResult,
  blossomKeys?: BlossomKeyMap,
): Promise<VerificationDetail> {
  return verifyProof(
    requestToRequirement(request),
    resultToVerificationInput(result),
    { blossomKeys },
  );
}

function checkC2paSignature(
  c2pa: { available: boolean; hasManifest: boolean; signatureValid: boolean },
  checks: string[],
  failures: string[],
): void {
  if (!c2pa.available) {
    failures.push(
      "C2PA: c2patool not available — cannot verify Content Credentials",
    );
  } else if (!c2pa.hasManifest) {
    failures.push(
      "C2PA: no Content Credentials found — use a C2PA-enabled camera",
    );
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
    const dist = haversineKm(
      gps.lat,
      gps.lon,
      expectedGps.lat,
      expectedGps.lon,
    );
    if (dist <= maxGpsDist) {
      checks.push(
        `${label} GPS within ${maxGpsDist}km of expected (${
          dist.toFixed(1)
        }km)`,
      );
    } else {
      failures.push(
        `${label} GPS ${
          dist.toFixed(1)
        }km from expected location (max ${maxGpsDist}km)`,
      );
    }
  } else if (gps) {
    checks.push(`${label} GPS: ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`);
  }
}

function checkProofModeRecord(
  proofmode: {
    checks: string[];
    failures: string[];
    proof: { locationLatitude: number; locationLongitude: number } | null;
  } | undefined,
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  checks: string[],
  failures: string[],
): void {
  if (!proofmode) return;
  for (const c of proofmode.checks) checks.push(c);
  for (const f of proofmode.failures) failures.push(f);

  if (
    proofmode.proof && expectedGps &&
    (proofmode.proof.locationLatitude !== 0 ||
      proofmode.proof.locationLongitude !== 0)
  ) {
    const gps = {
      lat: proofmode.proof.locationLatitude,
      lon: proofmode.proof.locationLongitude,
    };
    checkGpsProximity(
      gps,
      expectedGps,
      maxGpsDist,
      "ProofMode",
      checks,
      failures,
    );
  }
}

function checkExifRecord(
  exif: {
    hasExif: boolean;
    hasCameraModel: boolean;
    hasTimestamp: boolean;
    timestampRecent: boolean;
    hasGps: boolean;
    gpsNearHint: boolean | null;
    metadata: { make?: string; model?: string };
  },
  checks: string[],
  failures: string[],
): void {
  if (!exif.hasExif) {
    checks.push("EXIF: no metadata (stripped by worker for privacy)");
    return;
  }

  if (exif.hasCameraModel) {
    checks.push(
      `EXIF: camera identified (${
        [exif.metadata.make, exif.metadata.model].filter(Boolean).join(" ")
      })`,
    );
  } else {
    checks.push(
      "EXIF: present but no camera model (screenshot or processed image)",
    );
  }

  if (exif.hasTimestamp) {
    checks.push(
      exif.timestampRecent
        ? "EXIF: timestamp is recent"
        : "EXIF: timestamp is not recent (older photo)",
    );
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

async function verifyPhotoIntegrity(
  requirementId: string,
  attachments: AttachmentRef[],
  checks: string[],
  failures: string[],
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  blossomKeys?: BlossomKeyMap,
): Promise<void> {
  const integrityRecords = attachments
    .map((att) => getIntegrity(att.id))
    .filter((m) => m !== null);

  if (integrityRecords.length === 0) {
    const byRequest = getIntegrityForRequest(requirementId);
    if (byRequest.length > 0) {
      integrityRecords.push(...byRequest);
    }
  }

  if (integrityRecords.length === 0) {
    await verifyC2paFromAttachments(
      attachments,
      checks,
      failures,
      expectedGps,
      maxGpsDist,
      blossomKeys,
    );
    return;
  }

  for (const record of integrityRecords) {
    checkC2paSignature(record.c2pa, checks, failures);
    checkGpsProximity(
      record.c2pa.gps,
      expectedGps,
      maxGpsDist,
      "C2PA",
      checks,
      failures,
    );
    checkProofModeRecord(
      record.proofmode,
      expectedGps,
      maxGpsDist,
      checks,
      failures,
    );
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
    checkGpsProximity(
      c2pa.gps,
      expectedGps,
      maxGpsDist,
      "C2PA",
      checks,
      failures,
    );
    validated = true;
  }

  if (
    !validated && attachments.some((a) => a.mime_type?.startsWith("image/"))
  ) {
    failures.push("C2PA: no image attachments could be verified");
  }
}
