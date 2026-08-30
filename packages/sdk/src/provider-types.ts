import type { Clock } from "./requests/domain/ports.ts";
import type {
  ActorStateStore,
  CashuClient,
  RelayClient,
} from "./adapters/types.ts";
import type { OracleClient } from "./oracle.ts";
import type { Spec } from "@anchr/protocol/types";
import type {
  ProofGenerator,
  SchemaOptionsMap,
  SchemaProducer,
  SchemaProducerContext,
} from "./schema.ts";

export type {
  ActorStateStore,
  CashuClient,
  ProofGenerator,
  RelayClient,
  SchemaProducer,
  SchemaProducerContext,
};

export interface ProviderOffer {
  amountSats: number;
  produce: (
    selection: ProviderSelectionContext,
  ) => Promise<{ data: unknown; proof: Uint8Array | string }>;
}

export interface ProviderRequestEvent {
  customerPubkey: string;
  spec: Spec;
  maxAmountSats: number;
  oraclePubkey: string;
  proofGenerator?: ProofGenerator;
  schemaOptions?: SchemaOptionsMap;
}

export interface ProviderSelectionContext {
  spec: Spec;
  mint: string;
  amountSats: number;
  maxAmountSats: number;
  locktimeSeconds: number;
}

export type ProviderHandler = (
  request: ProviderRequestEvent,
) => Promise<ProviderOffer | null>;

/** Provider-side construction options. */
export interface ProviderOptions {
  /** Time source for state timestamps. */
  clock?: Clock;
  /** Optional region code; when set, only `#region`-matching requests are served. */
  regionCode?: string;
  /** Whitelist of accepted oracle pubkeys (npub or hex). */
  oracles: string[];
  /** Nostr relay URLs to subscribe and publish on. */
  relays: string[];
  /** Cashu mint URL. */
  mint: string;
  /** Provider's secret key (nsec or hex). */
  privKey: string;
  /** Payment adapter. The bundled Cashu HTLC adapter is one implementation. */
  cashuClient: CashuClient;
  /** Transport adapter. The bundled Nostr relay adapter is one implementation. */
  relayClient: RelayClient;
  /** Optional hash-bootstrap clients keyed by Oracle pubkey. Defaults to relay-DM bootstrap. */
  oracleClients?: Record<string, OracleClient>;
  /** Optional local state adapter for browser, Node, Deno, or test persistence. */
  stateStore?: ActorStateStore;
  /** Optional Proof Schema configuration keyed by Proof Schema URL. */
  schemaOptions?: SchemaOptionsMap;
  selectionTimeoutMs?: number;
  hashTimeoutMs?: number;
  preimageTimeoutMs?: number;
  proofGenerators?: readonly ProofGenerator[];
}
