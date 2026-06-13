/** Evidence-presence policy when a submission carries no attachments. */

import type { FactorCheck } from "./types.ts";

export const emptySubmissionCheck: FactorCheck = {
  name: "empty-submission",
  run(ctx) {
    if ((ctx.input.attachments ?? []).length > 0) return;
    if (ctx.input.schema_evidence !== undefined) return;
    ctx.acc.failures.push(
      "no media evidence provided — photos are required when photo-backed verification is enabled",
    );
  },
};
