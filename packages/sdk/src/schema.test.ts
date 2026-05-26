import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  DEFINED_SCHEMAS,
  type ProofGenerator,
  resolveProofGenerator,
  resolveVerifierAdapter,
  type VerifierAdapter,
} from "./schema.ts";

test("resolveProofGenerator dispatches with canHandle", () => {
  const first: ProofGenerator = {
    canHandle: () => false,
    produce: async () => ({ data: "first", proof: "first" }),
  };
  const second: ProofGenerator = {
    canHandle: (schema) => schema === DEFINED_SCHEMAS.TLSN_HTTPS_V1,
    produce: async () => ({ data: "second", proof: "second" }),
  };
  expect(resolveProofGenerator([first, second], DEFINED_SCHEMAS.TLSN_HTTPS_V1))
    .toBe(second);
});

test("resolveProofGenerator returns null for unhandled schema", () => {
  const generator: ProofGenerator = {
    canHandle: () => false,
    produce: async () => ({ data: "unused", proof: "unused" }),
  };
  expect(resolveProofGenerator([generator], DEFINED_SCHEMAS.TLSN_HTTPS_V1))
    .toBe(null);
});

test("resolveVerifierAdapter dispatches with canHandle", () => {
  const first: VerifierAdapter = {
    canHandle: () => false,
    verify: () => false,
  };
  const second: VerifierAdapter = {
    canHandle: (schema) => schema === DEFINED_SCHEMAS.C2PA_IMAGE_V1,
    verify: () => true,
  };
  expect(
    resolveVerifierAdapter([first, second], DEFINED_SCHEMAS.C2PA_IMAGE_V1),
  ).toBe(second);
});

test("resolveVerifierAdapter returns null for unhandled schema", () => {
  const verifier: VerifierAdapter = {
    canHandle: () => false,
    verify: () => true,
  };
  expect(resolveVerifierAdapter([verifier], DEFINED_SCHEMAS.C2PA_IMAGE_V1))
    .toBe(null);
});
