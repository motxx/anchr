/** Evidence-presence policy when a submission carries no attachments. */

import type { FactorCheck, FactorCheckContext } from "./types.ts";

type EmptySubmissionEvidencePolicy = (ctx: FactorCheckContext) => boolean;

export function createEmptySubmissionCheck(
  requiresEvidence: EmptySubmissionEvidencePolicy = () => true,
): FactorCheck {
  return {
    name: "empty-submission",
    run(ctx) {
      if ((ctx.input.attachments ?? []).length > 0) return;
      if (!requiresEvidence(ctx)) {
        ctx.acc.checks.push("no media evidence provided (weak verification)");
        return;
      }
      ctx.acc.failures.push(
        "no media evidence provided — photos are required when photo-backed verification is enabled",
      );
    },
  };
}

export const emptySubmissionCheck = createEmptySubmissionCheck();
