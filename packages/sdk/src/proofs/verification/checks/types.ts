/**
 * Factor-check registry contract. Each check owns one verification factor
 * family; the verifier core only resolves and runs registered checks and
 * aggregates the verdict.
 */

import type { validateTlsn } from "../../tlsn-validation.ts";
import type { IntegrityStore } from "../../integrity-store.ts";
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
  /**
   * TLSNotary validator. Defaults to the real `validateTlsn`; callers may
   * inject an alternative (e.g. one bound to a specific verifier binary).
   */
  validateTlsn?: typeof validateTlsn;
  /**
   * Attachment integrity records. Defaults to the module-level singleton
   * populated at upload time; hosts that compose their own
   * `createIntegrityStore()` inject it here.
   */
  integrityStore?: IntegrityStore;
}

export interface FactorCheckContext {
  requirement: VerificationRequirement;
  input: VerificationInput;
  maxGpsDistanceKm: number;
  acc: CheckAccumulator;
  options: VerifyProofOptions;
  schemaVerdict?: unknown;
}

export interface FactorCheck {
  name: string;
  run(ctx: FactorCheckContext): Promise<void> | void;
}
