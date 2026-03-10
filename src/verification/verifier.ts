import { checkAttachmentContent } from "./ai-content-check";
import { validateC2pa } from "./c2pa-validation";
import { getIntegrity, getIntegrityForQuery } from "./integrity-store";
import { fetchBlossomAttachment } from "../blossom/fetch-attachment";
import type {
  AttachmentRef,
  PhotoProofResult,
  Query,
  QueryResult,
  StoreStatusResult,
  VerificationDetail,
  WebpageFieldResult,
} from "../types";

export async function verify(query: Query, result: QueryResult): Promise<VerificationDetail> {
  const checks: string[] = [];
  const failures: string[] = [];

  switch (query.type) {
    case "photo_proof":
      verifyPhotoProof(result as PhotoProofResult, checks, failures);
      await verifyPhotoIntegrity(query.id, result as PhotoProofResult, checks, failures);
      break;
    case "store_status":
      verifyStoreStatus(result as StoreStatusResult, checks, failures);
      if ((result as StoreStatusResult).attachments?.length) {
        await verifyPhotoIntegrity(query.id, result as unknown as PhotoProofResult, checks, failures);
      }
      break;
    case "webpage_field":
      verifyWebpageField(
        result as WebpageFieldResult,
        (query.params as { anchor_word: string }).anchor_word,
        checks,
        failures,
      );
      break;
  }

  const hasAttachments = query.type === "photo_proof"
    || (query.type === "store_status" && (result as StoreStatusResult).attachments?.length);
  if (hasAttachments && failures.length === 0) {
    const aiResult = await checkAttachmentContent(query, result);
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

function verifyPhotoProof(
  result: PhotoProofResult,
  checks: string[],
  failures: string[],
): void {
  if (Array.isArray(result.attachments) && result.attachments.length > 0) {
    checks.push("photo attachment present");
  } else {
    failures.push("at least one photo attachment is required");
  }

  if (result.text_answer && result.text_answer.length > 5000) {
    failures.push("text_answer too long (max 5000 chars)");
  }
}

/**
 * Verify photo integrity using pre-strip EXIF and C2PA metadata.
 *
 * C2PA is mandatory — photos without valid Content Credentials are rejected.
 * EXIF checks are advisory (GPS, camera model add trust signals but don't fail).
 */
async function verifyPhotoIntegrity(
  queryId: string,
  result: PhotoProofResult,
  checks: string[],
  failures: string[],
): Promise<void> {
  // Try to find integrity data for attachments in this result
  const integrityRecords = result.attachments
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
    await verifyC2paFromAttachments(result.attachments, checks, failures);
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
): Promise<void> {
  if (attachments.length === 0) return;

  let validated = false;
  for (const att of attachments) {
    if (!att.mime_type?.startsWith("image/")) continue;

    // Try to fetch from Blossom (decentralized path)
    let data: Uint8Array | null = null;
    if (att.storage_kind === "blossom") {
      data = await fetchBlossomAttachment(att);
    }

    // Try to fetch from URL (local/external path)
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

function verifyStoreStatus(
  result: StoreStatusResult,
  checks: string[],
  failures: string[],
): void {
  if (result.status !== "open" && result.status !== "closed") {
    failures.push(`status must be "open" or "closed", got "${result.status}"`);
  }

  if (Array.isArray(result.attachments) && result.attachments.length > 0) {
    checks.push("photo attachment present");
  } else {
    checks.push("no photo evidence provided (weak verification)");
  }
}

function verifyWebpageField(
  result: WebpageFieldResult,
  anchorWord: string,
  checks: string[],
  failures: string[],
): void {
  if (!result.answer || result.answer.trim().length === 0) {
    failures.push("answer is empty");
  }

  if (!result.proof_text || result.proof_text.trim().length === 0) {
    failures.push("proof_text is empty");
  }

  if (result.proof_text?.includes(anchorWord)) {
    checks.push(`anchor word "${anchorWord}" found in proof_text`);
  } else {
    failures.push(`anchor word "${anchorWord}" not found in proof_text`);
  }

  if (result.answer && result.answer.length > 2000) {
    failures.push("answer too long (max 2000 chars)");
  }
}
