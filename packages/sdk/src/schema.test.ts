import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  DEFINED_SCHEMAS,
  isSchemaUri,
  resolveProducer,
  resolveVerifier,
  UnknownSchemaError,
  InvalidSchemaUriError,
} from "./schema.ts";
import type { SchemaProducer, SchemaVerifier } from "./types.ts";

test("DEFINED_SCHEMAS exposes the v0.0.1 schemas", () => {
  expect(DEFINED_SCHEMAS.TLSN_HTTPS_V1).toBe("io.anchr.tlsn-https.v1");
  expect(DEFINED_SCHEMAS.C2PA_IMAGE_V1).toBe("io.anchr.c2pa-image.v1");
});

test("isSchemaUri accepts the defined schemas", () => {
  expect(isSchemaUri("io.anchr.tlsn-https.v1")).toBe(true);
  expect(isSchemaUri("io.anchr.c2pa-image.v1")).toBe(true);
});

test("isSchemaUri accepts third-party reverse-DNS schemas", () => {
  expect(isSchemaUri("com.example.custom-proof.v1")).toBe(true);
  expect(isSchemaUri("org.foo.bar-baz.v42")).toBe(true);
});

test("isSchemaUri rejects malformed strings", () => {
  expect(isSchemaUri("io.anchr.tlsn-https")).toBe(false); // missing version suffix
  expect(isSchemaUri("anchr.v1")).toBe(false); // single-segment
  expect(isSchemaUri("Io.Anchr.tlsn-https.v1")).toBe(false); // uppercase
  expect(isSchemaUri("io.anchr.tlsn_https.v1")).toBe(false); // underscore
  expect(isSchemaUri("")).toBe(false);
  expect(isSchemaUri(123)).toBe(false);
  expect(isSchemaUri(null)).toBe(false);
});

test("resolveProducer returns the registered handler", () => {
  const producer: SchemaProducer = async () => ({ data: null, proof: "" });
  const registry = { "io.anchr.tlsn-https.v1": producer };
  expect(resolveProducer(registry, "io.anchr.tlsn-https.v1")).toBe(producer);
});

test("resolveProducer returns null for unregistered schema", () => {
  expect(resolveProducer({}, "io.anchr.tlsn-https.v1")).toBe(null);
});

test("resolveVerifier returns the registered handler", () => {
  const verifier: SchemaVerifier = () => true;
  const registry = { "io.anchr.c2pa-image.v1": verifier };
  expect(resolveVerifier(registry, "io.anchr.c2pa-image.v1")).toBe(verifier);
});

test("resolveVerifier returns null for unregistered schema", () => {
  expect(resolveVerifier({}, "io.anchr.c2pa-image.v1")).toBe(null);
});

test("UnknownSchemaError carries the offending URI", () => {
  const err = new UnknownSchemaError("io.anchr.unknown.v1");
  expect(err.uri).toBe("io.anchr.unknown.v1");
  expect(err.message).toContain("io.anchr.unknown.v1");
});

test("InvalidSchemaUriError carries the offending value", () => {
  const err = new InvalidSchemaUriError("not-a-uri");
  expect(err.value).toBe("not-a-uri");
  expect(err.message).toContain("not-a-uri");
});
