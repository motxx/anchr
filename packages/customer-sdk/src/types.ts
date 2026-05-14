import type { OracleClient } from "@anchr/oracle-sdk";
import type {
  Offer,
  Payment,
  RequestResult,
  Spec,
  VerifierAdapter,
} from "@anchr/protocol/types";
import type { CashuClient, CashuProof } from "./cashu.ts";
import type { RelayClient } from "./nostr.ts";
import type { ActorStateStore } from "./storage.ts";

export type { Offer, Payment, RequestResult, Spec, VerifierAdapter };

/** Strategy for picking an offer among the ones received within `offerWindowMs`. */
export type OfferSelector = (offers: Offer[]) => Offer | null;

/** Customer-side construction options. */
export interface CustomerOptions {
  /** Whitelist of accepted oracle pubkeys (npub or hex). The SDK selects one per query. */
  oracles: string[];
  /** Nostr relay URLs the SDK will publish to and subscribe from. */
  relays: string[];
  /** Cashu mint URL (must support HTLC / NUT-14). */
  mint: string;
  /** Adapter for talking to the oracle. */
  oracleClient: OracleClient;
  /** Payment adapter. The bundled Cashu HTLC adapter is one implementation. */
  cashuClient: CashuClient;
  /** Transport adapter. The bundled Nostr relay adapter is one implementation. */
  relayClient: RelayClient;
  /** Optional local state adapter for browser, Node, Deno, or test persistence. */
  stateStore?: ActorStateStore;
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
