/**
 * Schema-check contract. Each registered proof schema owns the checks that
 * evaluate its requirement and evidence payloads.
 */

import type { SchemaOptions, SchemaOptionsMap } from "../../../schema.ts";
import type { BlossomKeyMap } from "../../../values.ts";
import type {
  VerificationInput,
  VerificationRequirement,
} from "../contract.ts";

export interface CheckAccumulator {
  checks: string[];
  failures: string[];
  warnings: string[];
}

/** Options for `verifyProof` and `verify`. */
export interface VerifyProofOptions {
  /** Per-attachment Blossom decryption keys. */
  blossomKeys?: BlossomKeyMap;
  /** Per-schema verifier configuration keyed by schema URI. */
  schemaOptions?: SchemaOptionsMap;
}

export interface FactorCheckContext {
  requirement: VerificationRequirement;
  input: VerificationInput;
  acc: CheckAccumulator;
  options: VerifyProofOptions;
  schemaOptions: SchemaOptions;
  schemaVerdict?: unknown;
}

export interface FactorCheck {
  name: string;
  run(ctx: FactorCheckContext): Promise<void> | void;
}
