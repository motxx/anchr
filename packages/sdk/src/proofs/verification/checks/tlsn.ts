/** TLSNotary factor: attestation or extension-result presentations. */

import { validateTlsn } from "../../tlsn-validation.ts";
import {
  isTlsnAttestation,
  isTlsnExtensionResult,
  isTlsnRequirement,
} from "../../tlsn-types.ts";
import type { ValidateTlsnOptions } from "../../tlsn-validation.ts";
import type { SidecarExecutor } from "../../../internal/runtime/mod.ts";
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

export interface TlsnSchemaOptions {
  validateTlsn?: typeof validateTlsn;
  verifierPath?: string | null;
  executor?: SidecarExecutor;
  notaryUrl?: string;
}

function isSidecarExecutor(value: unknown): value is SidecarExecutor {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.spawn === "function" &&
    typeof record.which === "function" &&
    typeof record.isFile === "function";
}

function isTlsnSchemaOptions(value: unknown): value is TlsnSchemaOptions {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record.validateTlsn !== undefined &&
    typeof record.validateTlsn !== "function"
  ) {
    return false;
  }
  if (
    record.verifierPath !== undefined &&
    record.verifierPath !== null &&
    typeof record.verifierPath !== "string"
  ) {
    return false;
  }
  if (
    record.executor !== undefined &&
    !isSidecarExecutor(record.executor)
  ) {
    return false;
  }
  if (
    record.notaryUrl !== undefined && typeof record.notaryUrl !== "string"
  ) {
    return false;
  }
  return true;
}

function schemaOptionsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

export function parseTlsnSchemaOptions(value: unknown): TlsnSchemaOptions {
  if (isTlsnSchemaOptions(value)) return value;
  throw new Error("TLSNotary Proof Schema options must be an object");
}

async function verifyTlsnExtensionResult(
  extResult: TlsnExtensionResult,
  requirement: TlsnRequirementPayload,
  acc: CheckAccumulator,
  validateTlsnFn: typeof validateTlsn,
  validateOptions?: ValidateTlsnOptions,
): Promise<TlsnVerifiedData | undefined> {
  if (extResult.presentation) {
    const tlsnResult = await validateTlsnFn(
      { presentation: extResult.presentation },
      requirement,
      validateOptions,
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
  validateOptions?: ValidateTlsnOptions,
): Promise<TlsnVerifiedData | undefined> {
  const tlsnResult = await validateTlsnFn(
    attestation,
    requirement,
    validateOptions,
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
  validateOptions?: ValidateTlsnOptions,
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
      validateOptions,
    );
  }
  if (isTlsnAttestation(input.schema_evidence)) {
    return verifyTlsnAttestation(
      input.schema_evidence,
      requirement.schema_requirement,
      acc,
      validateTlsnFn,
      validateOptions,
    );
  }
  acc.failures.push("TLSNotary: invalid schema_evidence");
  return undefined;
}

export function createTlsnCheck(
  defaultOptions: TlsnSchemaOptions = {},
): FactorCheck {
  return {
    name: "tlsn",
    async run(ctx) {
      const options = parseTlsnSchemaOptions({
        ...defaultOptions,
        ...schemaOptionsRecord(ctx.schemaOptions),
      });
      ctx.schemaVerdict = await verifyTlsn(
        ctx.requirement,
        ctx.input,
        ctx.acc,
        options.validateTlsn ?? validateTlsn,
        { verifierPath: options.verifierPath, executor: options.executor },
      );
    },
  };
}
