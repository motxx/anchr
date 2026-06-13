import { ProofSchema } from "@anchr/protocol/schema";
import type { SchemaBundle, SchemaOptions } from "../schema.ts";
import {
  createTlsnCheck,
  parseTlsnSchemaOptions,
} from "./verification/checks/tlsn.ts";
import type { TlsnSchemaOptions } from "./verification/checks/tlsn.ts";

export function createTlsnSchemaBundle(
  options: TlsnSchemaOptions = {},
): SchemaBundle {
  return {
    uri: ProofSchema.TlsnV1,
    checks: [createTlsnCheck(options)],
    configSchema(value: unknown): SchemaOptions {
      return parseTlsnSchemaOptions(value);
    },
    resolveEvidence(payload) {
      return typeof payload.proof === "string" && payload.proof.length > 0
        ? { presentation: payload.proof }
        : undefined;
    },
  };
}
