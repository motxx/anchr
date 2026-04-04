/**
 * Helpers for attachment upload pipeline.
 */

import { Buffer } from "node:buffer";
import type { ProofModeIntegrity } from "./verification/integrity-store";
import type { ProofModeData } from "./verification/proofmode-validation";

export function detectZip(rawBuffer: Buffer, filename: string): boolean {
  return filename.endsWith(".zip") || (rawBuffer[0] === 0x50 && rawBuffer[1] === 0x4b);
}

export function inferMimeType(filename: string): string {
  if (filename.match(/\.(png)$/i)) return "image/png";
  if (filename.match(/\.(heic)$/i)) return "image/heic";
  if (filename.match(/\.(webp)$/i)) return "image/webp";
  return "image/jpeg";
}

export function extractProofModeIntegrity(pmData: ProofModeData): ProofModeIntegrity {
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
  c2paResult: { checks: string[]; failures: string[] },
  proofmode?: ProofModeIntegrity,
) {
  const checks = [...exifResult.checks, ...c2paResult.checks];
  const failures = [...exifResult.failures, ...c2paResult.failures];
  if (proofmode) {
    checks.push(...proofmode.checks);
    failures.push(...proofmode.failures);
  }
  if (checks.length > 0) {
    console.error(`[integrity] ${queryId}: ${checks.join("; ")}`);
  }
  if (failures.length > 0) {
    console.error(`[integrity] ${queryId} warnings: ${failures.join("; ")}`);
  }
}
