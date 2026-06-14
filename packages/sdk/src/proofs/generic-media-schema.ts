import type { SchemaBundle } from "../schema.ts";
import { createEmptySubmissionCheck } from "./verification/checks/empty-submission.ts";
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

function hasNonEmptySchemaEvidence(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "object" || value === null) return true;
  return Object.keys(value).length > 0;
}

export function createGenericMediaSchemaBundle(): SchemaBundle {
  return {
    uri: GenericMediaSchemaUri,
    checks: [
      createEmptySubmissionCheck((ctx) =>
        ctx.requirement.schema_requirement !== undefined ||
        hasNonEmptySchemaEvidence(ctx.input.schema_evidence)
      ),
      genericMediaCheck,
    ],
  };
}
