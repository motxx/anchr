/**
 * Schema URI dispatch.
 *
 * The SDK dispatches by URI string only — predicate shape, proof format,
 * and verification rules live in each schema's document. Built-in URIs:
 *   - io.anchr.tlsn-https.v1 — TLSNotary attestation of an HTTPS response
 *   - io.anchr.c2pa-image.v1 — C2PA-signed photo / video with optional GPS predicate
 *
 * Custom schemas plug in by registering a producer/verifier at construction.
 */

import type { SchemaProducer, SchemaVerifier } from "./types.ts";

/** Reverse-DNS schema URI form. The SDK does not validate semantics; it only dispatches by string match. */
export type SchemaUri = string;

/** Defined schema URIs that this SDK version commits to as stable identifiers. */
export const DEFINED_SCHEMAS = {
  TLSN_HTTPS_V1: "io.anchr.tlsn-https.v1",
  C2PA_IMAGE_V1: "io.anchr.c2pa-image.v1",
} as const;

/** Type-level enumeration of defined URIs. */
export type DefinedSchemaUri = typeof DEFINED_SCHEMAS[keyof typeof DEFINED_SCHEMAS];

/** Returns true when the URI is a syntactically plausible schema URI (reverse-DNS + version). */
export function isSchemaUri(value: unknown): value is SchemaUri {
  if (typeof value !== "string") return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\.v\d+$/.test(value);
}

/**
 * Resolves a schema URI to its registered handler.
 *
 * Returns null if no handler is registered. Callers MUST handle the null
 * case (the customer/provider returns an error to the peer; the SDK does
 * not silently fall back to a default).
 */
export function resolveProducer(
  registry: Record<SchemaUri, SchemaProducer>,
  uri: SchemaUri,
): SchemaProducer | null {
  return registry[uri] ?? null;
}

export function resolveVerifier(
  registry: Record<SchemaUri, SchemaVerifier>,
  uri: SchemaUri,
): SchemaVerifier | null {
  return registry[uri] ?? null;
}

/** Thrown when a schema URI is required but not registered with the SDK. */
export class UnknownSchemaError extends Error {
  constructor(public readonly uri: SchemaUri) {
    super(`Unknown schema URI: ${uri}`);
    this.name = "UnknownSchemaError";
  }
}

/** Thrown when a schema URI fails the syntactic shape check. */
export class InvalidSchemaUriError extends Error {
  constructor(public readonly value: unknown) {
    super(`Invalid schema URI: ${String(value)}`);
    this.name = "InvalidSchemaUriError";
  }
}
