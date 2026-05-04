/**
 * Schema URI dispatch.
 *
 * The SDK is verification-format-agnostic. Each request carries a
 * `schema` URI; the provider and oracle interpret it. New formats plug
 * in by publishing a schema (out-of-band) and registering a producer /
 * verifier with the SDK at construction time.
 *
 * Built-in schema URIs (Defined):
 *   - io.anchr.tlsn-https.v1 — TLSNotary attestation of an HTTPS response
 *   - io.anchr.c2pa-image.v1 — C2PA-signed photo / video with optional GPS predicate
 *
 * Anyone can introduce a new schema URI by:
 *   1. Publishing a schema document (e.g. as a Nostr addressable event,
 *      kind 30xxx, with `d` tag = the URI) defining the predicate shape,
 *      proof format, and verification rules.
 *   2. Registering a producer (provider side) and verifier (customer side)
 *      with the SDK that follow that schema's contract.
 *
 * The URI string is the only thing the SDK looks at when dispatching;
 * resolution of the URI to its document is intentionally pluggable so
 * that a future Nostr-based schema registry, a static JSON file, or any
 * other lookup mechanism can serve the document without SDK changes.
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
  // Reverse-DNS: at least two dot-segments + ".v<digits>" suffix, only ASCII letters/digits/dashes/dots.
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
