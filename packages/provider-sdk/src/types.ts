import type {
  ActorStateStore,
  CashuClient,
  RelayClient,
} from "@anchr/protocol/adapters";
import type {
  ProofGenerator,
  ProviderHandler,
  ProviderOffer,
  ProviderRequestEvent,
  SchemaProducer,
  SchemaProducerContext,
} from "@anchr/protocol/types";

export type {
  ActorStateStore,
  CashuClient,
  ProofGenerator,
  ProviderHandler,
  ProviderOffer,
  ProviderRequestEvent,
  RelayClient,
  SchemaProducer,
  SchemaProducerContext,
};

/** Provider-side construction options. */
export interface ProviderOptions {
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
  /** Optional local state adapter for browser, Node, Deno, or test persistence. */
  stateStore?: ActorStateStore;
  /** Optional: TLSN notary URL. */
  notary?: string;
  selectionTimeoutMs?: number;
  preimageTimeoutMs?: number;
  proofGenerators?: readonly ProofGenerator[];
}
