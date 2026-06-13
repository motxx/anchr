/**
 * Photo-evidence factor: C2PA Content Credentials, ProofMode records, and
 * EXIF metadata, with attachment retrieval and integrity-store lookup.
 */

import { Buffer } from "node:buffer";
import {
  type C2paImageEvidence,
  type C2paImageRequirement,
  type C2paValidationResult,
  DEFAULT_C2PA_MAX_GPS_DISTANCE_KM,
  evaluateC2paGpsProximity,
  type GpsCoord,
  isC2paImageEvidence,
  isC2paImageRequirement,
  validateC2pa,
  verifyC2paGpsBinding,
} from "../../c2pa-validation.ts";
import {
  getDefaultIntegrityStore,
  type IntegrityStore,
} from "../../integrity-store.ts";
import { fetchAttachmentData } from "../../../attachments/fetch-attachment.ts";
import type { SidecarExecutor } from "../../../internal/runtime/mod.ts";
import type { AttachmentRef, BlossomKeyMap } from "../../../values.ts";
import type { FactorCheck } from "./types.ts";

export interface C2paImageSchemaOptions {
  c2paToolPath?: string | null;
  executor?: SidecarExecutor;
  integrityStore?: IntegrityStore;
}

function isIntegrityStore(value: unknown): value is IntegrityStore {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.get === "function" &&
    typeof record.getForRequest === "function" &&
    typeof record.store === "function" &&
    typeof record.clear === "function";
}

function isSidecarExecutor(value: unknown): value is SidecarExecutor {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.spawn === "function" &&
    typeof record.which === "function" &&
    typeof record.isFile === "function";
}

function isC2paImageSchemaOptions(
  value: unknown,
): value is C2paImageSchemaOptions {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record.c2paToolPath !== undefined &&
    record.c2paToolPath !== null &&
    typeof record.c2paToolPath !== "string"
  ) {
    return false;
  }
  if (
    record.integrityStore !== undefined &&
    !isIntegrityStore(record.integrityStore)
  ) {
    return false;
  }
  if (
    record.executor !== undefined &&
    !isSidecarExecutor(record.executor)
  ) {
    return false;
  }
  return true;
}

function schemaOptionsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

export function parseC2paImageSchemaOptions(
  value: unknown,
): C2paImageSchemaOptions {
  if (isC2paImageSchemaOptions(value)) return value;
  throw new Error("C2PA image schema options must be an object");
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

function checkC2paGpsBinding(
  c2pa: C2paValidationResult,
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  checks: string[],
  failures: string[],
): void {
  if (!expectedGps) {
    checkC2paSignature(c2pa, checks, failures);
    if (c2pa.gps) {
      const result = evaluateC2paGpsProximity(
        c2pa.gps,
        expectedGps,
        maxGpsDist,
        "C2PA",
      );
      checks.push(...result.checks);
      failures.push(...result.failures);
    }
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
    const result = evaluateC2paGpsProximity(
      gps,
      expectedGps,
      maxGpsDist,
      "ProofMode",
    );
    checks.push(...result.checks);
    failures.push(...result.failures);
  }
}

function resolveC2paRequirement(
  payload: unknown,
  failures: string[],
): C2paImageRequirement | null {
  if (payload === undefined) return {};
  if (!isC2paImageRequirement(payload)) {
    failures.push("C2PA image: query missing or invalid schema_requirement");
    return null;
  }
  return payload;
}

function resolveC2paEvidence(
  payload: unknown,
  failures: string[],
): C2paImageEvidence | null {
  if (payload === undefined) return {};
  if (!isC2paImageEvidence(payload)) {
    failures.push("C2PA image: invalid schema_evidence");
    return null;
  }
  return payload;
}

function checkSchemaEvidenceGps(
  requirement: C2paImageRequirement,
  evidence: C2paImageEvidence,
  checks: string[],
  failures: string[],
): void {
  const maxGpsDist = requirement.max_gps_distance_km ??
    DEFAULT_C2PA_MAX_GPS_DISTANCE_KM;
  if (evidence.gps) {
    const result = evaluateC2paGpsProximity(
      evidence.gps,
      requirement.expected_gps,
      maxGpsDist,
      "C2PA schema_evidence",
    );
    checks.push(...result.checks);
    failures.push(...result.failures);
  } else if (requirement.expected_gps) {
    failures.push("C2PA image: GPS coordinates missing from schema_evidence");
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
  integrityStore: IntegrityStore,
  c2paToolPath?: string | null,
  executor?: SidecarExecutor,
  blossomKeys?: BlossomKeyMap,
): Promise<void> {
  const integrityRecords = attachments
    .map((att) => integrityStore.get(att.id))
    .filter((m) => m !== null);

  if (integrityRecords.length === 0) {
    const byRequest = integrityStore.getForRequest(requirementId);
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
      c2paToolPath,
      executor,
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

async function verifyC2paFromAttachments(
  attachments: AttachmentRef[],
  checks: string[],
  failures: string[],
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  requiresC2pa: boolean,
  c2paToolPath?: string | null,
  executor?: SidecarExecutor,
  blossomKeys?: BlossomKeyMap,
): Promise<void> {
  if (attachments.length === 0) return;

  let validated = false;
  for (const att of attachments) {
    if (!att.mime_type?.startsWith("image/")) continue;

    const fetched = await fetchAttachmentData(att, blossomKeys);
    if (!fetched.ok) {
      failures.push(`C2PA: ${fetched.reason}`);
      continue;
    }

    const filename = att.filename ?? att.id ?? "photo.jpg";
    const c2pa = await validateC2pa(Buffer.from(fetched.data), filename, {
      toolPath: c2paToolPath,
      executor,
    });

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

export function createPhotoIntegrityCheck(
  defaultOptions: C2paImageSchemaOptions = {},
): FactorCheck {
  return {
    name: "photo-integrity",
    async run(ctx) {
      const attachments = ctx.input.attachments ?? [];
      const c2paRequirement = resolveC2paRequirement(
        ctx.requirement.schema_requirement,
        ctx.acc.failures,
      );
      const c2paEvidence = resolveC2paEvidence(
        ctx.input.schema_evidence,
        ctx.acc.failures,
      );
      if (c2paRequirement === null || c2paEvidence === null) return;

      checkSchemaEvidenceGps(
        c2paRequirement,
        c2paEvidence,
        ctx.acc.checks,
        ctx.acc.failures,
      );

      if (attachments.length === 0) return;
      ctx.acc.checks.push("attachment present");
      const maxGpsDistanceKm = c2paRequirement.max_gps_distance_km ??
        DEFAULT_C2PA_MAX_GPS_DISTANCE_KM;
      const options = parseC2paImageSchemaOptions({
        ...defaultOptions,
        ...schemaOptionsRecord(ctx.schemaOptions),
      });
      await verifyPhotoIntegrity(
        ctx.requirement.id,
        attachments,
        ctx.acc.checks,
        ctx.acc.failures,
        c2paRequirement.expected_gps,
        maxGpsDistanceKm,
        true,
        options.integrityStore ?? getDefaultIntegrityStore(),
        options.c2paToolPath,
        options.executor,
        ctx.options.blossomKeys,
      );
    },
  };
}
