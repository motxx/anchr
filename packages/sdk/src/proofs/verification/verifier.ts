/**
 * Verifier core: resolve the registered factor checks for a requirement,
 * run them over the evidence, and aggregate the verdict. Factor-specific
 * logic lives in `./checks/`; adding a factor is one check module plus one
 * registry entry.
 *
 * The host orchestrator is responsible for the *trust envelope* around this
 * call: who signed the requirement, replay protection, deadline enforcement.
 * This module only answers "does the evidence satisfy the policy".
 */

import type {
  VerificationDetail,
  VerificationInput,
  VerificationRequirement,
} from "./contract.ts";
import { defaultFactorChecks } from "./checks/registry.ts";
import type {
  CheckAccumulator,
  FactorCheck,
  FactorCheckContext,
  VerifyProofOptions,
} from "./checks/types.ts";

export type { FactorCheck, VerifyProofOptions };
export { checkAttachmentContent } from "./checks/ai-content.ts";

const DEFAULT_MAX_GPS_DISTANCE_KM = 50;

/** Pure proof verification over an explicit policy and evidence pair. */
export async function verifyProof(
  requirement: VerificationRequirement,
  input: VerificationInput,
  options?: VerifyProofOptions,
  checks: readonly FactorCheck[] = defaultFactorChecks,
): Promise<VerificationDetail> {
  const acc: CheckAccumulator = { checks: [], failures: [], warnings: [] };
  const ctx: FactorCheckContext = {
    requirement,
    input,
    maxGpsDistanceKm: requirement.max_gps_distance_km ??
      DEFAULT_MAX_GPS_DISTANCE_KM,
    acc,
    options: options ?? {},
  };

  for (const check of checks) {
    await check.run(ctx);
  }

  return {
    passed: acc.failures.length === 0,
    checks: acc.checks,
    failures: acc.failures,
    warnings: acc.warnings.length > 0 ? acc.warnings : undefined,
    tlsn_verified: ctx.tlsnVerified,
  };
}
