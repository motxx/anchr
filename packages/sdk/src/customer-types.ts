import type { OracleClient } from "./oracle.ts";
import type { Clock, IdGenerator } from "./requests/domain/ports.ts";
import type {
  ActorStateStore,
  CashuClient,
  CashuProof,
  RelayClient,
} from "./adapters/types.ts";
import type {
  Offer,
  Payment,
  RequestResult as ProtocolRequestResult,
  Spec,
} from "@anchr/protocol/types";
import type { SchemaOptionsMap, VerifierAdapter } from "./schema.ts";

export type { Offer, Payment, Spec, VerifierAdapter };
export type {
  ActorStateStore,
  CashuClient,
  CashuProof,
  RelayClient,
} from "./adapters/types.ts";

/** Result returned by the SDK Customer after a successful purchase. */
export interface RequestResult extends ProtocolRequestResult {
  /** Cashu proofs kept by the wallet while sizing the Payment Lock. */
  paymentChangeProofs?: readonly CashuProof[];
}

/** Strategy for picking an offer among the ones received within `offerWindowMs`. */
export type OfferSelector = (offers: Offer[]) => Offer | null;

/** Strategy for picking one trusted oracle pubkey for a request. */
export type OracleSelector = (oracles: readonly string[]) => string;

/** Trusted oracle plus the transport used to request its hash. */
export interface CustomerOracle {
  /** Trusted oracle pubkey selected into the query request. */
  pubkey: string;
  /**
   * Adapter for talking to this oracle. Defaults to the relay-DM hash
   * bootstrap client (`createNostrOracleClient`) over the Customer's
   * relayClient; pass an explicit client (e.g. HTTP) to override.
   */
  client?: OracleClient;
}

/** Customer-side construction options. */
export interface CustomerOptions {
  /** Time source for expiries, locktimes, and state timestamps. */
  clock?: Clock;
  /** Query-id source (defaults to the engine's crypto-backed generator). */
  idGenerator?: IdGenerator;
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
  schemaOptions?: SchemaOptionsMap;
}

/** Options for a single customer.request() call. */
export interface RequestOptions {
  spec: Spec;
  payment: Payment;
  /** Funding proofs used to create the Provider-bound Payment Lock. */
  sourceProofs: CashuProof[];
  /** Receives Cashu proofs kept as change from Payment Lock creation. */
  onPaymentChange?: (proofs: readonly CashuProof[]) => void | Promise<void>;
  /** Optional: target a specific provider pubkey instead of broadcasting. */
  provider?: string;
  /**
   * Optional region code added as a `region` tag for scoped discovery.
   * The tag is published as cleartext and is relay-indexable (`#region`),
   * so any relay observer can partition requests by region — supplying it
   * shrinks the requester's anonymity set. Omit unless regional scoping
   * is required.
   */
  regionCode?: string;
}
