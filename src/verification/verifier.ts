import { checkAttachmentContent } from "./ai-content-check";
import { validateC2pa } from "./c2pa-validation";
import { getIntegrity, getIntegrityForQuery } from "./integrity-store";
import { fetchBlossomAttachment } from "../blossom/fetch-attachment";
import type {
  AttachmentRef,
  BlossomKeyMap,
  Query,
  QueryResult,
  VerificationDetail,
} from "../types";

/**
 * Verify a query result cryptographically.
 *
 * Oracle checks:
 * 1. Attachments present → C2PA / EXIF integrity
 * 2. AI content check (opt-in, if attachments pass crypto checks)
 * 3. No attachments → weak verification (pass with advisory)
 */
export async function verify(query: Query, result: QueryResult, blossomKeys?: BlossomKeyMap): Promise<VerificationDetail> {
  const checks: string[] = [];
  const failures: string[] = [];

  const attachments = result.attachments ?? [];

  if (attachments.length > 0) {
    checks.push("attachment present");
    await verifyPhotoIntegrity(query.id, attachments, checks, failures, blossomKeys);
  } else {
    checks.push("no media evidence provided (weak verification)");
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
  };
}

/**
 * Verify photo integrity using pre-strip EXIF and C2PA metadata.
 *
 * C2PA is mandatory — photos without valid Content Credentials are rejected.
 * EXIF checks are advisory (GPS, camera model add trust signals but don't fail).
 */
async function verifyPhotoIntegrity(
  queryId: string,
  attachments: AttachmentRef[],
  checks: string[],
  failures: string[],
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
    await verifyC2paFromAttachments(attachments, checks, failures, blossomKeys);
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

    // ProofMode bundle checks
    if (record.proofmode) {
      const pm = record.proofmode;
      for (const c of pm.checks) checks.push(c);
      for (const f of pm.failures) failures.push(f);
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

    // Try to fetch from URL (external path)
    if (!data && att.uri) {
      try {
        const response = await fetch(att.uri);
        if (response.ok) {
          data = new Uint8Array(await response.arrayBuffer());
        }
      } catch {
        // fetch failed, continue
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
    validated = true;
  }

  if (!validated && attachments.some((a) => a.mime_type?.startsWith("image/"))) {
    failures.push("C2PA: no image attachments could be verified");
  }
}
