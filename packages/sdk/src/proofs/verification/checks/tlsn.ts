/** TLSNotary factor: attestation or extension-result presentations. */

import { validateTlsn } from "../../tlsn-validation.ts";
import type { TlsnVerifiedData } from "../../tlsn-types.ts";
import type {
  VerificationInput,
  VerificationRequirement,
} from "../../../requests/domain/types.ts";
import type { CheckAccumulator, FactorCheck } from "./types.ts";

async function verifyTlsnExtensionResult(
  extResult: {
    presentation?: string;
    results?: Array<{ type: string; part: string; value: string }>;
  },
  requirement: VerificationRequirement,
  acc: CheckAccumulator,
  validateTlsnFn: typeof validateTlsn,
): Promise<TlsnVerifiedData | undefined> {
  if (extResult.presentation && requirement.tlsn_requirements) {
    const tlsnResult = await validateTlsnFn(
      { presentation: extResult.presentation },
      requirement.tlsn_requirements,
    );
    acc.checks.push(...tlsnResult.checks);
    acc.failures.push(...tlsnResult.failures);
    return tlsnResult.verifiedData;
  } else if (!extResult.presentation) {
    acc.failures.push(
      "TLSNotary extension: no cryptographic presentation included — self-reported data cannot be trusted",
    );
  } else {
    acc.failures.push("TLSNotary extension: query missing tlsn_requirements");
  }
  return undefined;
}

async function verifyTlsnAttestation(
  input: VerificationInput,
  requirement: VerificationRequirement,
  acc: CheckAccumulator,
  validateTlsnFn: typeof validateTlsn,
): Promise<TlsnVerifiedData | undefined> {
  if (!input.tlsn_attestation) {
    acc.failures.push("TLSNotary: no attestation provided");
    return undefined;
  }
  if (!requirement.tlsn_requirements) {
    acc.failures.push("TLSNotary: query missing tlsn_requirements");
    return undefined;
  }
  const tlsnResult = await validateTlsnFn(
    input.tlsn_attestation,
    requirement.tlsn_requirements,
  );
  acc.checks.push(...tlsnResult.checks);
  acc.failures.push(...tlsnResult.failures);
  return tlsnResult.verifiedData;
}

async function verifyTlsn(
  requirement: VerificationRequirement,
  input: VerificationInput,
  acc: CheckAccumulator,
  validateTlsnFn: typeof validateTlsn,
): Promise<TlsnVerifiedData | undefined> {
  if (input.tlsn_extension_result) {
    const extResult = input.tlsn_extension_result as {
      presentation?: string;
      results?: Array<{ type: string; part: string; value: string }>;
    };
    return verifyTlsnExtensionResult(
      extResult,
      requirement,
      acc,
      validateTlsnFn,
    );
  }
  return verifyTlsnAttestation(input, requirement, acc, validateTlsnFn);
}

export const tlsnCheck: FactorCheck = {
  name: "tlsn",
  async run(ctx) {
    if (!ctx.requirement.factors.includes("tlsn")) return;
    ctx.tlsnVerified = await verifyTlsn(
      ctx.requirement,
      ctx.input,
      ctx.acc,
      ctx.options.validateTlsn ?? validateTlsn,
    );
  },
};
