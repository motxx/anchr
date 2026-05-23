import type { OracleClient } from "./oracle.ts";
import type {
  ActorStateStore,
  CashuClient,
  CashuProof,
  RelayClient,
} from "@anchr/protocol/adapters";
import type {
  Offer,
  Payment,
  RequestResult,
  Spec,
  VerifierAdapter,
} from "@anchr/protocol/types";

export type { Offer, Payment, RequestResult, Spec, VerifierAdapter };
export type {
  ActorStateStore,
  CashuClient,
  CashuProof,
  RelayClient,
} from "@anchr/protocol/adapters";

/** Strategy for picking an offer among the ones received within `offerWindowMs`. */
export type OfferSelector = (offers: Offer[]) => Offer | null;

/** Strategy for picking one trusted oracle pubkey for a request. */
export type OracleSelector = (oracles: readonly string[]) => string;

/** Trusted oracle plus the transport used to request its hash. */
export interface CustomerOracle {
  /** Trusted oracle pubkey selected into the query request. */
  pubkey: string;
  /** Adapter for talking to this oracle. */
  client: OracleClient;
}

/** Customer-side construction options. */
export interface CustomerOptions {
  /** Trusted oracles. The SDK selects exactly one per query. */
  oracles: CustomerOracle[];
  /** Nostr relay URLs the SDK will publish to and subscribe from. */
  relays: string[];
  /** Cashu mint URL (must support HTLC / NUT-14). */
  mint: string;
  /** Payment adapter. The bundled Cashu HTLC adapter is one implementation. */
  cashuClient: CashuClient;
  /** Transport adapter. The bundled Nostr relay adapter is one implementation. */
  relayClient: RelayClient;
  /** Optional local state adapter for browser, Node, Deno, or test persistence. */
  stateStore?: ActorStateStore;
  /** Optional strategy for selecting one oracle from the whitelist per request. */
  oracleSelector?: OracleSelector;
  offerSelector?: OfferSelector;
  offerWindowMs?: number;
  resultTimeoutMs?: number;
  verifierAdapters?: readonly VerifierAdapter[];
}

/** Options for a single customer.request() call. */
export interface RequestOptions {
  spec: Spec;
  payment: Payment;
  /** Source proofs to lock at the Cashu mint. */
  sourceProofs: CashuProof[];
  /** Optional: target a specific provider pubkey instead of broadcasting. */
  provider?: string;
}
