import { checkAttachmentContent } from "./ai-content-check";
import { validateC2pa } from "./c2pa-validation";
import { haversineKm } from "./exif-validation";
import { getIntegrity, getIntegrityForQuery } from "./integrity-store";
import { validateTlsn } from "./tlsn-validation";
import { fetchBlossomAttachment } from "../blossom/fetch-attachment";
import { validateAttachmentUri } from "../infrastructure/url-validation";
import type {
  AttachmentRef,
  BlossomKeyMap,
  GpsCoord,
  Query,
  QueryResult,
  TlsnVerifiedData,
  VerificationDetail,
} from "../domain/types";
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
export async function verify(query: Query, result: QueryResult, blossomKeys?: BlossomKeyMap): Promise<VerificationDetail> {
  const checks: string[] = [];
  const failures: string[] = [];
  let tlsnVerifiedData: TlsnVerifiedData | undefined;
  const maxGpsDist = query.max_gps_distance_km ?? DEFAULT_MAX_GPS_DISTANCE_KM;

  const attachments = result.attachments ?? [];

  // --- Fix 1: Reject empty submissions when evidence is required ---
  // TLSNotary queries don't require photo attachments
  const hasTlsn = query.verification_requirements.includes("tlsn");
  if (attachments.length === 0) {
    const requiresEvidence =
      query.verification_requirements.includes("nonce") ||
      query.verification_requirements.includes("gps");

    if (requiresEvidence && !hasTlsn) {
      failures.push("no media evidence provided — photos are required when GPS or nonce verification is enabled");
    } else if (!hasTlsn) {
      checks.push("no media evidence provided (weak verification)");
    }
  }

  // --- Fix 2: Validate body GPS against expected GPS ---
  if (result.gps && query.expected_gps) {
    const dist = haversineKm(result.gps.lat, result.gps.lon, query.expected_gps.lat, query.expected_gps.lon);
    if (dist <= maxGpsDist) {
      checks.push(`body GPS within ${maxGpsDist}km of expected (${dist.toFixed(1)}km)`);
    } else {
      failures.push(`body GPS ${dist.toFixed(1)}km from expected location (max ${maxGpsDist}km)`);
    }
  } else if (!result.gps && query.expected_gps && query.verification_requirements.includes("gps")) {
    failures.push("GPS coordinates missing from submission body — required by verification policy");
  }

  // --- TLSNotary verification ---
  if (hasTlsn) {
    if (result.tlsn_extension_result) {
      // Browser extension result — MUST include a cryptographic presentation.
      // The extension_result alone is self-reported worker data and CANNOT be trusted.
      // Require a signed TLSNotary presentation for cryptographic verification.
      const extResult = result.tlsn_extension_result as {
        presentation?: string;
        results?: Array<{ type: string; part: string; value: string }>;
      };

      if (extResult.presentation && query.tlsn_requirements) {
        // Has cryptographic proof — verify via the standard tlsn-verifier binary
        const tlsnResult = await _validateTlsnFn(
          { presentation: extResult.presentation },
          query.tlsn_requirements,
        );
        checks.push(...tlsnResult.checks);
        failures.push(...tlsnResult.failures);
        if (tlsnResult.verifiedData) {
          tlsnVerifiedData = tlsnResult.verifiedData;
        }
      } else if (!extResult.presentation) {
        // No cryptographic proof — reject. Self-reported data is forgeable.
        failures.push("TLSNotary extension: no cryptographic presentation included — self-reported data cannot be trusted");
      } else {
        failures.push("TLSNotary extension: query missing tlsn_requirements");
      }
    } else if (!result.tlsn_attestation) {
      failures.push("TLSNotary: no attestation provided");
    } else if (!query.tlsn_requirements) {
      failures.push("TLSNotary: query missing tlsn_requirements");
    } else {
      const tlsnResult = await _validateTlsnFn(
        result.tlsn_attestation,
        query.tlsn_requirements,
      );
      checks.push(...tlsnResult.checks);
      failures.push(...tlsnResult.failures);
      // Attach verified data for downstream display
      if (tlsnResult.verifiedData) {
        tlsnVerifiedData = tlsnResult.verifiedData;
      }
    }
  }

  if (attachments.length > 0) {
    checks.push("attachment present");
    await verifyPhotoIntegrity(query.id, attachments, checks, failures, query.expected_gps, maxGpsDist, blossomKeys);
  }

  if (attachments.length > 0 && failures.length === 0) {
    const aiResult = await checkAttachmentContent(query, result, blossomKeys);
    if (aiResult) {
      if (aiResult.passed) {
        checks.push(`AI content check passed: ${aiResult.reason}`);
      } else {
        failures.push(`AI content check failed: ${aiResult.reason}`);
      }
    }
  }

  return {
    passed: failures.length === 0,
    checks,
    failures,
    tlsn_verified: tlsnVerifiedData,
  };
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
    const { exif, c2pa } = record;

    // C2PA (mandatory)
    if (!c2pa.available) {
      failures.push("C2PA: c2patool not available — cannot verify Content Credentials");
    } else if (!c2pa.hasManifest) {
      failures.push("C2PA: no Content Credentials found — use a C2PA-enabled camera");
    } else if (c2pa.signatureValid) {
      checks.push("C2PA: valid Content Credentials signature");
    } else {
      failures.push("C2PA: Content Credentials signature invalid");
    }

    // --- Fix 3: Compare C2PA GPS with expected GPS ---
    if (c2pa.gps && expectedGps) {
      const dist = haversineKm(c2pa.gps.lat, c2pa.gps.lon, expectedGps.lat, expectedGps.lon);
      if (dist <= maxGpsDist) {
        checks.push(`C2PA GPS within ${maxGpsDist}km of expected (${dist.toFixed(1)}km)`);
      } else {
        failures.push(`C2PA GPS ${dist.toFixed(1)}km from expected location (max ${maxGpsDist}km)`);
      }
    } else if (c2pa.gps) {
      checks.push(`C2PA GPS: ${c2pa.gps.lat.toFixed(4)}, ${c2pa.gps.lon.toFixed(4)}`);
    }

    // --- Fix 4: Compare ProofMode GPS with expected GPS ---
    if (record.proofmode) {
      const pm = record.proofmode;
      for (const c of pm.checks) checks.push(c);
      for (const f of pm.failures) failures.push(f);

      if (pm.proof && expectedGps && (pm.proof.locationLatitude !== 0 || pm.proof.locationLongitude !== 0)) {
        const dist = haversineKm(pm.proof.locationLatitude, pm.proof.locationLongitude, expectedGps.lat, expectedGps.lon);
        if (dist <= maxGpsDist) {
          checks.push(`ProofMode GPS within ${maxGpsDist}km of expected (${dist.toFixed(1)}km)`);
        } else {
          failures.push(`ProofMode GPS ${dist.toFixed(1)}km from expected location (max ${maxGpsDist}km)`);
        }
      }
    }

    // EXIF: camera model presence is a soft indicator
    if (exif.hasExif) {
      if (exif.hasCameraModel) {
        checks.push(`EXIF: camera identified (${[exif.metadata.make, exif.metadata.model].filter(Boolean).join(" ")})`);
      } else {
        checks.push("EXIF: present but no camera model (screenshot or processed image)");
      }

      if (exif.hasTimestamp) {
        if (exif.timestampRecent) {
          checks.push("EXIF: timestamp is recent");
        } else {
          checks.push("EXIF: timestamp is not recent (older photo)");
        }
      }

      if (exif.hasGps) {
        checks.push("EXIF: GPS coordinates present");
        if (exif.gpsNearHint === true) {
          checks.push("EXIF: GPS matches location hint");
        } else if (exif.gpsNearHint === false) {
          failures.push("EXIF: GPS coordinates far from expected location");
        }
      }
    } else {
      // No EXIF at all — expected when worker stripped before upload
      checks.push("EXIF: no metadata (stripped by worker for privacy)");
    }
  }
}

/**
 * Fetch Blossom attachments and run C2PA validation directly.
 * Used in the decentralized path where no pre-upload integrity data exists.
 */
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

    // Try to fetch from Blossom (decentralized path) using ephemeral keys
    let data: Uint8Array | null = null;
    if (att.storage_kind === "blossom") {
      const keyMaterial = blossomKeys?.[att.id];
      data = await fetchBlossomAttachment(att, keyMaterial);
    }

    // Try to fetch from URL (external path) — validate URI to prevent SSRF
    if (!data && att.uri) {
      const uriError = validateAttachmentUri(att.uri);
      if (uriError) {
        failures.push(`C2PA: attachment URI rejected (${uriError})`);
      } else {
        try {
          const response = await fetch(att.uri);
          if (response.ok) {
            data = new Uint8Array(await response.arrayBuffer());
          }
        } catch {
          // fetch failed, continue
        }
      }
    }

    if (!data) {
      failures.push("C2PA: could not retrieve attachment for verification");
      continue;
    }

    const filename = att.filename ?? att.id ?? "photo.jpg";
    const c2pa = await validateC2pa(Buffer.from(data), filename);

    if (!c2pa.available) {
      failures.push("C2PA: c2patool not available — cannot verify Content Credentials");
    } else if (!c2pa.hasManifest) {
      failures.push("C2PA: no Content Credentials found — use a C2PA-enabled camera");
    } else if (c2pa.signatureValid) {
      checks.push("C2PA: valid Content Credentials signature");
    } else {
      failures.push("C2PA: Content Credentials signature invalid");
    }

    // --- Fix 3: Compare C2PA GPS in decentralized path ---
    if (c2pa.gps && expectedGps) {
      const dist = haversineKm(c2pa.gps.lat, c2pa.gps.lon, expectedGps.lat, expectedGps.lon);
      if (dist <= maxGpsDist) {
        checks.push(`C2PA GPS within ${maxGpsDist}km of expected (${dist.toFixed(1)}km)`);
      } else {
        failures.push(`C2PA GPS ${dist.toFixed(1)}km from expected location (max ${maxGpsDist}km)`);
      }
    }

    validated = true;
  }

  if (!validated && attachments.some((a) => a.mime_type?.startsWith("image/"))) {
    failures.push("C2PA: no image attachments could be verified");
  }
}
