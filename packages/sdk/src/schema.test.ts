import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  type ProofGenerator,
  ProofSchema,
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
    canHandle: (schema) => schema === ProofSchema.TlsnV1,
    produce: async () => ({ data: "second", proof: "second" }),
  };
  expect(resolveProofGenerator([first, second], ProofSchema.TlsnV1))
    .toBe(second);
});

test("resolveProofGenerator returns null for unhandled schema", () => {
  const generator: ProofGenerator = {
    canHandle: () => false,
    produce: async () => ({ data: "unused", proof: "unused" }),
  };
  expect(resolveProofGenerator([generator], ProofSchema.TlsnV1))
    .toBe(null);
});

test("resolveVerifierAdapter dispatches with canHandle", () => {
  const first: VerifierAdapter = {
    canHandle: () => false,
    verify: () => false,
  };
  const second: VerifierAdapter = {
    canHandle: (schema) => schema === ProofSchema.C2paImageV1,
    verify: () => true,
  };
  expect(
    resolveVerifierAdapter([first, second], ProofSchema.C2paImageV1),
  ).toBe(second);
});

test("resolveVerifierAdapter returns null for unhandled schema", () => {
  const verifier: VerifierAdapter = {
    canHandle: () => false,
    verify: () => true,
  };
  expect(resolveVerifierAdapter([verifier], ProofSchema.C2paImageV1))
    .toBe(null);
});
