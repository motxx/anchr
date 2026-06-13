import type { SchemaUri } from "@anchr/protocol/schema";
import type {
  FactorCheck,
  VerifyProofOptions,
} from "./proofs/verification/checks/types.ts";

export {
  InvalidSchemaUriError,
  isSchemaUri,
  ProofSchema,
  type SchemaUri,
  UnknownSchemaError,
} from "@anchr/protocol/schema";

export type SchemaProducer = (
  predicate: unknown,
  context: SchemaProducerContext,
) => Promise<{ data: unknown; proof: Uint8Array | string }>;

export type SchemaOptions = unknown;
export type SchemaOptionsMap = Readonly<Record<SchemaUri, SchemaOptions>>;

export interface SchemaProducerContext {
  customerPubkey: string;
  options?: SchemaOptions;
}

export interface ProofGenerator {
  canHandle(schema: string): boolean;
  produce: SchemaProducer;
}

export type SchemaVerifier = (
  proof: Uint8Array | string,
  predicate: unknown,
  data: unknown,
  context?: SchemaVerifierContext,
) => boolean | Promise<boolean>;

export interface SchemaVerifierContext {
  options?: SchemaOptions;
}

export interface VerifierAdapter {
  canHandle(schema: string): boolean;
  verify: SchemaVerifier;
}

export interface SchemaEvidencePayload {
  data: unknown;
  proof: Uint8Array | string;
}

export type SchemaEvidenceResolver = (
  payload: SchemaEvidencePayload,
) => unknown;

export type SchemaConfigParser = (value: unknown) => SchemaOptions;

export interface SchemaBundle {
  uri: SchemaUri;
  producer?: SchemaProducer;
  verifier?: SchemaVerifier;
  checks?: readonly FactorCheck[];
  configSchema?: SchemaConfigParser;
  resolveEvidence?: SchemaEvidenceResolver;
}

const schemaBundles = new Map<SchemaUri, SchemaBundle>();

function bundleToProofGenerator(bundle: SchemaBundle): ProofGenerator | null {
  if (bundle.producer === undefined) return null;
  return {
    canHandle: (schema) => schema === bundle.uri,
    produce: bundle.producer,
  };
}

function bundleToVerifierAdapter(bundle: SchemaBundle): VerifierAdapter | null {
  if (bundle.verifier === undefined) return null;
  return {
    canHandle: (schema) => schema === bundle.uri,
    verify: bundle.verifier,
  };
}

export function registerSchemaBundle(bundle: SchemaBundle): () => void {
  if (schemaBundles.has(bundle.uri)) {
    throw new Error(`Schema bundle already registered: ${bundle.uri}`);
  }
  schemaBundles.set(bundle.uri, bundle);
  return () => {
    const current = schemaBundles.get(bundle.uri);
    if (current === bundle) schemaBundles.delete(bundle.uri);
  };
}

export function unregisterSchemaBundle(uri: SchemaUri): boolean {
  return schemaBundles.delete(uri);
}

export function getSchemaBundle(uri: SchemaUri): SchemaBundle | null {
  return schemaBundles.get(uri) ?? null;
}

export function getRegisteredSchemaBundles(): readonly SchemaBundle[] {
  return [...schemaBundles.values()];
}

export function resolveSchemaOptions(
  bundle: SchemaBundle,
  options?: VerifyProofOptions,
): SchemaOptions {
  const raw = options?.schemaOptions?.[bundle.uri] ?? {};
  return bundle.configSchema === undefined ? raw : bundle.configSchema(raw);
}

export function resolveSchemaEvidence(
  uri: SchemaUri,
  payload: SchemaEvidencePayload,
): unknown {
  return schemaBundles.get(uri)?.resolveEvidence?.(payload);
}

export function resolveProofGenerator(
  generators: readonly ProofGenerator[],
  uri: SchemaUri,
): ProofGenerator | null {
  const configured = generators.find((generator) => generator.canHandle(uri));
  if (configured !== undefined) return configured;
  const bundle = schemaBundles.get(uri);
  return bundle === undefined ? null : bundleToProofGenerator(bundle);
}

export function resolveVerifierAdapter(
  verifiers: readonly VerifierAdapter[],
  uri: SchemaUri,
): VerifierAdapter | null {
  const configured = verifiers.find((verifier) => verifier.canHandle(uri));
  if (configured !== undefined) return configured;
  const bundle = schemaBundles.get(uri);
  return bundle === undefined ? null : bundleToVerifierAdapter(bundle);
}
