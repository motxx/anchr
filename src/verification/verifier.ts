import { checkAttachmentContent } from "./ai-content-check";
import { getIntegrity, getIntegrityForQuery } from "./integrity-store";
import type {
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
      verifyPhotoIntegrity(query.id, result as PhotoProofResult, checks, failures);
      break;
    case "store_status":
      verifyStoreStatus(result as StoreStatusResult, checks, failures);
      if ((result as StoreStatusResult).attachments?.length) {
        verifyPhotoIntegrity(query.id, result as unknown as PhotoProofResult, checks, failures);
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
 * These are advisory checks — they add information to the verification
 * detail but only fail for strong indicators of fabrication.
 */
function verifyPhotoIntegrity(
  queryId: string,
  result: PhotoProofResult,
  checks: string[],
  failures: string[],
): void {
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

  if (integrityRecords.length === 0) {
    checks.push("integrity: no pre-upload metadata available (skipped)");
    return;
  }

  for (const record of integrityRecords) {
    const { exif, c2pa } = record;

    // C2PA
    if (!c2pa.available) {
      checks.push("C2PA: c2patool not available (skipped)");
    } else if (!c2pa.hasManifest) {
      checks.push("C2PA: checked, no Content Credentials found");
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
      // No EXIF at all — suspicious for a camera photo
      checks.push("EXIF: no metadata (possible AI-generated image or stripped before upload)");
    }
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
