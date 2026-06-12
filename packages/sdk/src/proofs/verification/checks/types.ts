/**
 * Factor-check registry contract. Each check owns one verification factor
 * family; the verifier core only resolves and runs registered checks and
 * aggregates the verdict.
 */

import type { validateTlsn } from "../../tlsn-validation.ts";
import type { IntegrityStore } from "../../integrity-store.ts";
import type { AiContentCheckConfig } from "../../ai-content-check.ts";
import type { TlsnVerifiedData } from "../../tlsn-types.ts";
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
   * AI content-check configuration. Defaults to the env-gated resolver
   * (AI_CONTENT_CHECK / ANTHROPIC_API_KEY) so deployments can enable the
   * factor without code; inject per-instance config in hosts and tests.
   */
  aiContent?: AiContentCheckConfig;
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
  /** Set by the TLSN check; surfaced on the final verdict. */
  tlsnVerified?: TlsnVerifiedData;
}

export interface FactorCheck {
  name: string;
  run(ctx: FactorCheckContext): Promise<void> | void;
}
