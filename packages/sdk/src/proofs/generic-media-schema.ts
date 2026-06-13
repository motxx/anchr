import type { SchemaBundle } from "../schema.ts";
import { emptySubmissionCheck } from "./verification/checks/empty-submission.ts";
import type { FactorCheck } from "./verification/checks/types.ts";

export const GenericMediaSchemaUri =
  "https://anchr-spec.org/spec/proof/photo/v1";

const genericMediaCheck: FactorCheck = {
  name: "generic-media",
  run(ctx) {
    if ((ctx.input.attachments ?? []).length > 0) {
      ctx.acc.checks.push("attachment present");
    }
  },
};

export function createGenericMediaSchemaBundle(): SchemaBundle {
  return {
    uri: GenericMediaSchemaUri,
    checks: [emptySubmissionCheck, genericMediaCheck],
  };
}
