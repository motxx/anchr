import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  DEFINED_SCHEMAS,
  InvalidSchemaUriError,
  isSchemaUri,
  resolveProducer,
  resolveProofGenerator,
  resolveVerifier,
  resolveVerifierAdapter,
  UnknownSchemaError,
} from "./schema.ts";
import type {
  ProofGenerator,
  SchemaProducer,
  SchemaVerifier,
  VerifierAdapter,
} from "./types.ts";

test("DEFINED_SCHEMAS exposes the v0.0.1 proof schema URLs", () => {
  expect(DEFINED_SCHEMAS.TLSN_HTTPS_V1).toBe(
    "https://anchr-spec.org/spec/proof/tlsn/v1",
  );
  expect(DEFINED_SCHEMAS.C2PA_IMAGE_V1).toBe(
    "https://anchr-spec.org/spec/proof/c2pa-image/v1",
  );
});

test("isSchemaUri accepts the defined schemas", () => {
  expect(isSchemaUri(DEFINED_SCHEMAS.TLSN_HTTPS_V1)).toBe(true);
  expect(isSchemaUri(DEFINED_SCHEMAS.C2PA_IMAGE_V1)).toBe(true);
});

test("isSchemaUri accepts third-party HTTPS proof schema URLs", () => {
  expect(isSchemaUri("https://example.com/spec/proof/custom-proof/v1")).toBe(
    true,
  );
  expect(isSchemaUri("https://proofs.example.org/spec/proof/bar-baz/v42")).toBe(
    true,
  );
});

test("isSchemaUri rejects malformed strings", () => {
  expect(isSchemaUri("io.anchr.tlsn-https.v1")).toBe(false);
  expect(isSchemaUri("http://anchr-spec.org/spec/proof/tlsn/v1")).toBe(
    false,
  );
  expect(isSchemaUri("https://anchr-spec.org/spec/proof/tlsn/v1?x=1")).toBe(
    false,
  );
  expect(isSchemaUri("https://anchr-spec.org/spec/proof/tlsn")).toBe(false);
  expect(isSchemaUri("https://anchr-spec.org/spec/proof/tlsn/v1#section"))
    .toBe(
      false,
    );
  expect(isSchemaUri("https://anchr-spec.org/spec/proof/tlsn_profile/v1"))
    .toBe(
      false,
    );
  expect(isSchemaUri("")).toBe(false);
  expect(isSchemaUri(123)).toBe(false);
  expect(isSchemaUri(null)).toBe(false);
});

test("resolveProducer returns the registered handler", () => {
  const producer: SchemaProducer = async () => ({ data: null, proof: "" });
  const registry = { [DEFINED_SCHEMAS.TLSN_HTTPS_V1]: producer };
  expect(resolveProducer(registry, DEFINED_SCHEMAS.TLSN_HTTPS_V1)).toBe(
    producer,
  );
});

test("resolveProducer returns null for unregistered schema", () => {
  expect(resolveProducer({}, DEFINED_SCHEMAS.TLSN_HTTPS_V1)).toBe(null);
});

test("resolveVerifier returns the registered handler", () => {
  const verifier: SchemaVerifier = () => true;
  const registry = { [DEFINED_SCHEMAS.C2PA_IMAGE_V1]: verifier };
  expect(resolveVerifier(registry, DEFINED_SCHEMAS.C2PA_IMAGE_V1)).toBe(
    verifier,
  );
});

test("resolveVerifier returns null for unregistered schema", () => {
  expect(resolveVerifier({}, DEFINED_SCHEMAS.C2PA_IMAGE_V1)).toBe(null);
});

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
  expect(resolveProducer([first, second], DEFINED_SCHEMAS.TLSN_HTTPS_V1)).toBe(
    second.produce,
  );
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
  expect(resolveVerifier([first, second], DEFINED_SCHEMAS.C2PA_IMAGE_V1)).toBe(
    second.verify,
  );
});

test("UnknownSchemaError carries the offending URI", () => {
  const err = new UnknownSchemaError("https://example.com/spec/proof/other/v1");
  expect(err.uri).toBe("https://example.com/spec/proof/other/v1");
  expect(err.message).toContain("https://example.com/spec/proof/other/v1");
});

test("InvalidSchemaUriError carries the offending value", () => {
  const err = new InvalidSchemaUriError("not-a-uri");
  expect(err.value).toBe("not-a-uri");
  expect(err.message).toContain("not-a-uri");
});
