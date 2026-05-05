import type { QueryStore } from "../domain/query-store.ts";
import type { PreimageStore } from "@anchr/core-cashu/preimage-port";
import type { EscrowProvider } from "./escrow-port.ts";
import type { FrostSignaturePort } from "./frost-signature-port.ts";
import type { OracleResolver, MultiOracleResolver } from "./query-verification.ts";
import type { ProofDelivery } from "./proof-delivery.ts";
import type { QueryResult } from "../domain/types.ts";
import type { CreateQueryOptions } from "./query-service.ts";

export interface ServiceDeps {
  store: QueryStore;
  oracleResolver: OracleResolver;
  multiOracleResolver?: MultiOracleResolver;
  preimageStore?: PreimageStore;
  escrowProvider?: EscrowProvider;
  frostSignature?: FrostSignaturePort;
  proofDelivery?: ProofDelivery;
  /** Normalize attachment refs in a QueryResult. Defaults to identity. */
  normalizeResult?: (result: QueryResult, requestUrl?: string) => QueryResult;
}

export const identityNormalize = (result: QueryResult): QueryResult => result;

export const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function resolveTtlMs(options?: CreateQueryOptions): number {
  if (!options) return DEFAULT_TTL_MS;
  if (typeof options.ttlMs === "number") return options.ttlMs;
  if (typeof options.ttlSeconds === "number") return options.ttlSeconds * 1000;
  return DEFAULT_TTL_MS;
}
