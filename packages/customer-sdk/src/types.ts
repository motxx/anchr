import type { OracleClient } from "@anchr/oracle-sdk";
import type {
  Payment,
  Quote,
  RequestResult,
  Spec,
  VerifierAdapter,
} from "@anchr/protocol/types";
import type { CashuClient, CashuProof } from "./cashu.ts";
import type { RelayClient } from "./nostr.ts";

export type { Payment, Quote, RequestResult, Spec, VerifierAdapter };

/** Strategy for picking a quote among the ones received within `quoteWindowMs`. */
export type QuoteSelector = (quotes: Quote[]) => Quote | null;

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
  cashuClient?: CashuClient;
  relayClient?: RelayClient;
  quoteSelector?: QuoteSelector;
  quoteWindowMs?: number;
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
