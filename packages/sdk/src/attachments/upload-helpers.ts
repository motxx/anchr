/**
 * Helpers for attachment upload pipeline.
 */

import { Buffer } from "node:buffer";
import type { ProofModeData, ProofModeIntegrity } from "../proofs/mod.ts";

import { getLogger } from "../internal/runtime/logger.ts";
const log = getLogger(["anchr", "integrity"]);

export function detectZip(rawBuffer: Buffer, filename: string): boolean {
  return filename.endsWith(".zip") ||
    (rawBuffer[0] === 0x50 && rawBuffer[1] === 0x4b);
}

export function extractProofModeIntegrity(
  pmData: ProofModeData,
): ProofModeIntegrity {
  return {
    proof: pmData.proof,
    hashValid: pmData.hashValid,
    pgpValid: pmData.pgpValid,
    hasOts: pmData.hasOts,
    hasDeviceCheck: pmData.hasDeviceCheck,
    checks: pmData.checks,
    failures: pmData.failures,
  };
}

export function logIntegrity(
  queryId: string,
  exifResult: { checks: string[]; failures: string[] },
  provenanceResult: { checks: string[]; failures: string[] },
  proofmode?: ProofModeIntegrity,
) {
  const checks = [...exifResult.checks, ...provenanceResult.checks];
  const failures = [...exifResult.failures, ...provenanceResult.failures];
  if (proofmode) {
    checks.push(...proofmode.checks);
    failures.push(...proofmode.failures);
  }
  if (checks.length > 0) {
    log.error(`${queryId}: ${checks.join("; ")}`);
  }
  if (failures.length > 0) {
    log.error(`${queryId} warnings: ${failures.join("; ")}`);
  }
}
