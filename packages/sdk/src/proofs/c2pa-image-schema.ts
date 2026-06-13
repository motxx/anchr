import { ProofSchema } from "@anchr/protocol/schema";
import type { SchemaBundle, SchemaOptions } from "../schema.ts";
import { getDefaultIntegrityStore } from "./integrity-store.ts";
import {
  createPhotoIntegrityCheck,
  parseC2paImageSchemaOptions,
} from "./verification/checks/photo-integrity.ts";
import type { C2paImageSchemaOptions } from "./verification/checks/photo-integrity.ts";
import { emptySubmissionCheck } from "./verification/checks/empty-submission.ts";

export function createC2paImageSchemaBundle(
  options: C2paImageSchemaOptions = {},
): SchemaBundle {
  const defaultOptions: C2paImageSchemaOptions = {
    integrityStore: getDefaultIntegrityStore(),
    ...options,
  };
  return {
    uri: ProofSchema.C2paImageV1,
    checks: [emptySubmissionCheck, createPhotoIntegrityCheck(defaultOptions)],
    configSchema(value: unknown): SchemaOptions {
      return parseC2paImageSchemaOptions(value);
    },
    resolveEvidence(payload) {
      return typeof payload.data === "object" && payload.data !== null
        ? payload.data
        : undefined;
    },
  };
}
