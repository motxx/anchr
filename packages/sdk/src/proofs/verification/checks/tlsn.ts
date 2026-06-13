/** TLSNotary factor: attestation or extension-result presentations. */

import { validateTlsn } from "../../tlsn-validation.ts";
import {
  isTlsnAttestation,
  isTlsnExtensionResult,
  isTlsnRequirement,
} from "../../tlsn-types.ts";
import type {
  TlsnAttestation,
  TlsnExtensionResult,
  TlsnRequirement,
  TlsnVerifiedData,
} from "../../tlsn-types.ts";
import type {
  VerificationInput,
  VerificationRequirement,
} from "../contract.ts";
import type { CheckAccumulator, FactorCheck } from "./types.ts";

async function verifyTlsnExtensionResult(
  extResult: TlsnExtensionResult,
  requirement: TlsnRequirementPayload,
  acc: CheckAccumulator,
  validateTlsnFn: typeof validateTlsn,
): Promise<TlsnVerifiedData | undefined> {
  if (extResult.presentation) {
    const tlsnResult = await validateTlsnFn(
      { presentation: extResult.presentation },
      requirement,
    );
    acc.checks.push(...tlsnResult.checks);
    acc.failures.push(...tlsnResult.failures);
    return tlsnResult.verifiedData;
  }
  acc.failures.push(
    "TLSNotary extension: no cryptographic presentation included — self-reported data cannot be trusted",
  );
  return undefined;
}

async function verifyTlsnAttestation(
  attestation: TlsnAttestation,
  requirement: TlsnRequirementPayload,
  acc: CheckAccumulator,
  validateTlsnFn: typeof validateTlsn,
): Promise<TlsnVerifiedData | undefined> {
  const tlsnResult = await validateTlsnFn(
    attestation,
    requirement,
  );
  acc.checks.push(...tlsnResult.checks);
  acc.failures.push(...tlsnResult.failures);
  return tlsnResult.verifiedData;
}

type TlsnRequirementPayload = TlsnRequirement;

async function verifyTlsn(
  requirement: VerificationRequirement,
  input: VerificationInput,
  acc: CheckAccumulator,
  validateTlsnFn: typeof validateTlsn,
): Promise<TlsnVerifiedData | undefined> {
  if (!isTlsnRequirement(requirement.schema_requirement)) {
    acc.failures.push("TLSNotary: query missing or invalid schema_requirement");
    return undefined;
  }
  if (input.schema_evidence === undefined) {
    acc.failures.push("TLSNotary: no attestation provided");
    return undefined;
  }
  if (isTlsnExtensionResult(input.schema_evidence)) {
    return verifyTlsnExtensionResult(
      input.schema_evidence,
      requirement.schema_requirement,
      acc,
      validateTlsnFn,
    );
  }
  if (isTlsnAttestation(input.schema_evidence)) {
    return verifyTlsnAttestation(
      input.schema_evidence,
      requirement.schema_requirement,
      acc,
      validateTlsnFn,
    );
  }
  acc.failures.push("TLSNotary: invalid schema_evidence");
  return undefined;
}

export const tlsnCheck: FactorCheck = {
  name: "tlsn",
  async run(ctx) {
    if (!ctx.requirement.factors.includes("tlsn")) return;
    ctx.schemaVerdict = await verifyTlsn(
      ctx.requirement,
      ctx.input,
      ctx.acc,
      ctx.options.validateTlsn ?? validateTlsn,
    );
  },
};
