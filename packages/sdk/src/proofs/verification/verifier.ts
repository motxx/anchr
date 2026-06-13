/**
 * Verifier core: resolve the registered schema bundle for a requirement,
 * run its checks over the evidence, and aggregate the verdict.
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
import { ensureReferenceSchemaBundlesRegistered } from "./checks/registry.ts";
import type {
  CheckAccumulator,
  FactorCheck,
  FactorCheckContext,
  VerifyProofOptions,
} from "./checks/types.ts";
import { getSchemaBundle, resolveSchemaOptions } from "../../schema.ts";
import { GenericMediaSchemaUri } from "../generic-media-schema.ts";

export type { FactorCheck, VerifyProofOptions };

/** Pure proof verification over an explicit policy and evidence pair. */
export async function verifyProof(
  requirement: VerificationRequirement,
  input: VerificationInput,
  options?: VerifyProofOptions,
): Promise<VerificationDetail> {
  ensureReferenceSchemaBundlesRegistered();
  const schema = requirement.schema ?? GenericMediaSchemaUri;
  const bundle = getSchemaBundle(schema);
  if (bundle === null) {
    return {
      passed: false,
      checks: [],
      failures: [`Unknown schema URL: ${schema}`],
    };
  }

  const checks = bundle.checks ?? [];
  const acc: CheckAccumulator = { checks: [], failures: [], warnings: [] };
  const ctx: FactorCheckContext = {
    requirement,
    input,
    acc,
    options: options ?? {},
    schemaOptions: resolveSchemaOptions(bundle, options),
  };

  for (const check of checks) {
    await check.run(ctx);
  }

  return {
    passed: acc.failures.length === 0,
    checks: acc.checks,
    failures: acc.failures,
    warnings: acc.warnings.length > 0 ? acc.warnings : undefined,
    schema_verdict: ctx.schemaVerdict,
  };
}
