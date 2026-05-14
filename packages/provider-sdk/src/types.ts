import type {
  ProofGenerator,
  ProviderHandler,
  ProviderQuote,
  ProviderRequestEvent,
  SchemaProducer,
  SchemaProducerContext,
} from "@anchr/protocol/types";
import type { CashuClient } from "./cashu.ts";
import type { RelayClient } from "./nostr.ts";
import type { ActorStateStore } from "./storage.ts";

export type {
  ProofGenerator,
  ProviderHandler,
  ProviderQuote,
  ProviderRequestEvent,
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
