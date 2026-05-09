/**
 * Schema URL dispatch.
 *
 * The SDK dispatches by HTTPS URL string only — predicate shape, proof
 * format, and verification rules live in each schema's document. Built-in
 * URLs:
 *   - https://anchr-spec.org/spec/proof/tlsn/v1 — TLSNotary attestation of an HTTPS response
 *   - https://anchr-spec.org/spec/proof/c2pa-image/v1 — C2PA-signed photo / video with optional GPS predicate
 *
 * Custom schemas plug in by registering a generator/verifier adapter with
 * canHandle(schema).
 */

import type {
  ProofGenerator,
  SchemaProducer,
  SchemaVerifier,
  SchemaVerifierRegistry,
  VerifierAdapter,
} from "./types.ts";

/** HTTPS proof schema URL form. The SDK validates shape and dispatches by URL. */
export type SchemaUri = string;

/** Defined schema URLs that this SDK version commits to as stable identifiers. */
export const DEFINED_SCHEMAS = {
  TLSN_HTTPS_V1: "https://anchr-spec.org/spec/proof/tlsn/v1",
  C2PA_IMAGE_V1: "https://anchr-spec.org/spec/proof/c2pa-image/v1",
} as const;

/** Type-level enumeration of defined schema URLs. */
export type DefinedSchemaUri =
  typeof DEFINED_SCHEMAS[keyof typeof DEFINED_SCHEMAS];

/** Returns true when the value is a syntactically plausible HTTPS proof schema URL. */
export function isSchemaUri(value: unknown): value is SchemaUri {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.search !== "" || url.hash !== "") return false;
  return /^\/spec\/proof\/[a-z0-9-]+\/v\d+$/.test(url.pathname);
}

/**
 * Resolves a schema URL to its registered producer.
 *
 * Returns null if no handler is registered. Callers MUST handle the null
 * case; the SDK does not silently fall back to a default.
 */
export function resolveProducer(
  registry: Record<SchemaUri, SchemaProducer> | readonly ProofGenerator[],
  uri: SchemaUri,
): SchemaProducer | null {
  if (isProofGeneratorList(registry)) {
    const generator = resolveProofGenerator(registry, uri);
    return generator?.produce ?? null;
  }
  return registry[uri] ?? null;
}

export function resolveVerifier(
  registry: SchemaVerifierRegistry,
  uri: SchemaUri,
): SchemaVerifier | null {
  if (isVerifierAdapterList(registry)) {
    const adapter = resolveVerifierAdapter(registry, uri);
    return adapter?.verify ?? null;
  }
  return registry[uri] ?? null;
}

export function resolveProofGenerator(
  generators: readonly ProofGenerator[],
  uri: SchemaUri,
): ProofGenerator | null {
  return generators.find((generator) => generator.canHandle(uri)) ?? null;
}

export function resolveVerifierAdapter(
  adapters: readonly VerifierAdapter[],
  uri: SchemaUri,
): VerifierAdapter | null {
  return adapters.find((adapter) => adapter.canHandle(uri)) ?? null;
}

function isProofGeneratorList(
  registry: Record<SchemaUri, SchemaProducer> | readonly ProofGenerator[],
): registry is readonly ProofGenerator[] {
  return Array.isArray(registry);
}

function isVerifierAdapterList(
  registry: SchemaVerifierRegistry,
): registry is readonly VerifierAdapter[] {
  return Array.isArray(registry);
}

/** Thrown when a schema URL is required but not registered with the SDK. */
export class UnknownSchemaError extends Error {
  constructor(public readonly uri: SchemaUri) {
    super(`Unknown schema URL: ${uri}`);
    this.name = "UnknownSchemaError";
  }
}

/** Thrown when a schema URL fails the syntactic shape check. */
export class InvalidSchemaUriError extends Error {
  constructor(public readonly value: unknown) {
    super(`Invalid schema URL: ${String(value)}`);
    this.name = "InvalidSchemaUriError";
  }
}
