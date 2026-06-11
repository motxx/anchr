/**
 * Photo-evidence factor: C2PA Content Credentials, ProofMode records, and
 * EXIF metadata, with attachment retrieval and integrity-store lookup.
 */

import { Buffer } from "node:buffer";
import {
  type C2paValidationResult,
  validateC2pa,
  verifyC2paGpsBinding,
} from "../../c2pa-validation.ts";
import { getIntegrity, getIntegrityForRequest } from "../../integrity-store.ts";
import { fetchBlossomAttachment } from "../../../attachments/fetch-attachment.ts";
import { validateAttachmentUri } from "../../../attachments/url-validation.ts";
import type {
  AttachmentRef,
  BlossomKeyMap,
  GpsCoord,
} from "../../../values.ts";
import { checkGpsProximity } from "./gps.ts";
import type { FactorCheck } from "./types.ts";

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

function checkC2paGpsBinding(
  c2pa: C2paValidationResult,
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  checks: string[],
  failures: string[],
): void {
  if (!expectedGps) {
    checkC2paSignature(c2pa, checks, failures);
    checkGpsProximity(
      c2pa.gps,
      expectedGps,
      maxGpsDist,
      "C2PA",
      checks,
      failures,
    );
    return;
  }

  const binding = verifyC2paGpsBinding(c2pa, {
    expectedGps,
    maxDistanceKm: maxGpsDist,
  });
  for (const c of binding.checks) checks.push(c);
  for (const f of binding.failures) failures.push(f);
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
    checks.push("EXIF: no metadata (stripped by provider for privacy)");
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
  requiresC2pa: boolean,
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
      requiresC2pa,
      blossomKeys,
    );
    return;
  }

  for (const record of integrityRecords) {
    checkC2paGpsBinding(
      record.c2pa,
      expectedGps,
      maxGpsDist,
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
  requiresC2pa: boolean,
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

    checkC2paGpsBinding(c2pa, expectedGps, maxGpsDist, checks, failures);
    validated = true;
  }

  if (validated) return;

  if (attachments.some((a) => a.mime_type?.startsWith("image/"))) {
    failures.push("C2PA: no image attachments could be verified");
  } else if (requiresC2pa) {
    failures.push(
      "C2PA: required Content Credentials evidence missing — no image submitted",
    );
  }
}

export const photoIntegrityCheck: FactorCheck = {
  name: "photo-integrity",
  async run(ctx) {
    const attachments = ctx.input.attachments ?? [];
    if (attachments.length === 0) return;
    ctx.acc.checks.push("attachment present");
    await verifyPhotoIntegrity(
      ctx.requirement.id,
      attachments,
      ctx.acc.checks,
      ctx.acc.failures,
      ctx.requirement.expected_gps,
      ctx.maxGpsDistanceKm,
      ctx.requirement.factors.includes("c2pa"),
      ctx.options.blossomKeys,
    );
  },
};

export { fetchAttachmentData };
