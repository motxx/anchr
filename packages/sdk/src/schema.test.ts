import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  getSchemaBundle,
  type ProofGenerator,
  ProofSchema,
  registerSchemaBundle,
  resolveProofGenerator,
  resolveSchemaEvidence,
  resolveVerifierAdapter,
  unregisterSchemaBundle,
  type VerifierAdapter,
} from "./schema.ts";

const CUSTOM_SCHEMA = "https://example.com/spec/proof/custom-proof/v1";

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
    canHandle: (schema) => schema === CUSTOM_SCHEMA,
    verify: () => true,
  };
  expect(
    resolveVerifierAdapter([first, second], CUSTOM_SCHEMA),
  ).toBe(second);
});

test("resolveVerifierAdapter returns null for unhandled schema", () => {
  const verifier: VerifierAdapter = {
    canHandle: () => false,
    verify: () => true,
  };
  expect(resolveVerifierAdapter([verifier], CUSTOM_SCHEMA))
    .toBe(null);
});

test("registerSchemaBundle registers producer, verifier, checks, and evidence resolver by URI", async () => {
  unregisterSchemaBundle(CUSTOM_SCHEMA);
  const dispose = registerSchemaBundle({
    uri: CUSTOM_SCHEMA,
    producer: async () => ({ data: "registered", proof: "proof" }),
    verifier: () => true,
    checks: [{
      name: "custom-check",
      run(ctx) {
        ctx.acc.checks.push("custom check ran");
      },
    }],
    resolveEvidence: (payload) => ({ data: payload.data }),
  });
  try {
    expect(getSchemaBundle(CUSTOM_SCHEMA)?.uri).toBe(CUSTOM_SCHEMA);
    const generator = resolveProofGenerator([], CUSTOM_SCHEMA);
    expect(generator).not.toBe(null);
    expect(await generator?.produce({}, { customerPubkey: "customer" }))
      .toEqual({ data: "registered", proof: "proof" });
    const verifier = resolveVerifierAdapter([], CUSTOM_SCHEMA);
    expect(verifier?.verify("proof", {}, {})).toBe(true);
    expect(
      resolveSchemaEvidence(CUSTOM_SCHEMA, { data: { ok: true }, proof: "" }),
    ).toEqual({ data: { ok: true } });
  } finally {
    dispose();
  }
});

test("registerSchemaBundle rejects duplicate schema URIs", () => {
  unregisterSchemaBundle(CUSTOM_SCHEMA);
  const dispose = registerSchemaBundle({ uri: CUSTOM_SCHEMA });
  try {
    expect(() => registerSchemaBundle({ uri: CUSTOM_SCHEMA })).toThrow();
  } finally {
    dispose();
  }
});
