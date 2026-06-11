/** Evidence-presence policy when a submission carries no attachments. */

import type { CheckAccumulator, FactorCheck } from "./types.ts";

function verifyEmptySubmission(
  factors: readonly string[],
  hasTlsn: boolean,
  acc: CheckAccumulator,
): void {
  const requiresEvidence = factors.includes("nonce") ||
    factors.includes("gps") ||
    factors.includes("c2pa");

  if (requiresEvidence && !hasTlsn) {
    acc.failures.push(
      "no media evidence provided — photos are required when photo-backed verification is enabled",
    );
  } else if (!hasTlsn) {
    acc.checks.push("no media evidence provided (weak verification)");
  }
}

export const emptySubmissionCheck: FactorCheck = {
  name: "empty-submission",
  run(ctx) {
    if ((ctx.input.attachments ?? []).length > 0) return;
    verifyEmptySubmission(
      ctx.requirement.factors,
      ctx.requirement.factors.includes("tlsn"),
      ctx.acc,
    );
  },
};
