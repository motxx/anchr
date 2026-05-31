import type { SchemaUri } from "@anchr/protocol/schema";

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

export interface SchemaProducerContext {
  notary?: string;
  customerPubkey: string;
}

export interface ProofGenerator {
  canHandle(schema: string): boolean;
  produce: SchemaProducer;
}

export type SchemaVerifier = (
  proof: Uint8Array | string,
  predicate: unknown,
  data: unknown,
) => boolean | Promise<boolean>;

export interface VerifierAdapter {
  canHandle(schema: string): boolean;
  verify: SchemaVerifier;
}

export function resolveProofGenerator(
  generators: readonly ProofGenerator[],
  uri: SchemaUri,
): ProofGenerator | null {
  return generators.find((generator) => generator.canHandle(uri)) ?? null;
}

export function resolveVerifierAdapter(
  verifiers: readonly VerifierAdapter[],
  uri: SchemaUri,
): VerifierAdapter | null {
  return verifiers.find((verifier) => verifier.canHandle(uri)) ?? null;
}
