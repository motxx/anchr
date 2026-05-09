/**
 * Core types for the @anchr/sdk Customer / Provider API.
 *
 * Wire-compatible with NIP-90 DVM (kinds 5300 / 6300 / 7000) and
 * intended to compose @anchr/cashu-conditional-swap, @anchr/core-cashu,
 * a TLSNotary verifier, and any compatible oracle.
 */

import type { CashuClient, CashuProof } from "./cashu.ts";
import type { OracleClient } from "./oracle.ts";
import type { RelayClient } from "./nostr.ts";

/** A specification of what the customer wants to buy. */
export interface Spec {
  /** Schema URL identifying the proof format and predicate shape. */
  schema: string;
  /** Schema-specific predicate. The shape is defined by the schema document. */
  predicate: unknown;
  /** Optional human-readable / AI-agent-readable description of intent. */
  description?: string;
  /** Optional schema-agnostic context (free-form). */
  context?: Record<string, unknown>;
}

/** Payment terms a customer attaches to a request. */
export interface Payment {
  /** Maximum amount in sats the customer will pay for a single quote. */
  maxAmount: number;
  /** Locktime in seconds from now (default: 3600). */
  locktimeSeconds?: number;
}

/** Result returned to the customer after a successful purchase. */
export interface RequestResult {
  /** Verified response payload (shape defined by the schema). */
  data: unknown;
  /** Proof bytes (format defined by the schema). */
  proof: Uint8Array | string;
  /** Hex pubkey of the provider that fulfilled the request. */
  providerPubkey: string;
  /** Schema URL under which the proof was produced. */
  schema: string;
}

/** A quote received from a provider in response to a request. */
export interface Quote {
  /** Provider's hex pubkey. */
  providerPubkey: string;
  /** Quoted amount in sats. */
  amountSats: number;
  /** Provider's quote event id (for selection). */
  quoteEventId: string;
  /** Local timestamp when the quote was received. */
  receivedAt: number;
}

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
  /** Adapter for talking to the oracle (HTTP, Nostr DM, FROST cluster, etc.). */
  oracleClient: OracleClient;
  /**
   * Optional: adapter for talking to the Cashu mint. When omitted the
   * SDK builds one from `mint`. Pass an explicit client to inject a
   * specific Wallet (e.g. to share state across requests).
   */
  cashuClient?: CashuClient;
  /**
   * Optional: pre-built relay client. When omitted the SDK builds one
   * from `relays` on each request. Tests inject a mock here.
   */
  relayClient?: RelayClient;
  /** Optional: how to choose among provider quotes. Default: cheapest within `payment.maxAmount`. */
  quoteSelector?: QuoteSelector;
  /** Optional: how long to wait for quotes before selecting (default: 30000 ms). */
  quoteWindowMs?: number;
  /** Optional: how long to wait for the kind 6300 result event before timing out (default: 300000 ms / 5 min). */
  resultTimeoutMs?: number;
  /** Optional: schema verifier handlers. The SDK calls these to verify a proof locally. */
  schemaVerifiers?: SchemaVerifierRegistry;
}

/** Provider-side construction options. */
export interface ProviderOptions {
  /** Whitelist of accepted oracle pubkeys (npub or hex). The provider will only quote on requests addressed to these oracles. */
  oracles: string[];
  /** Nostr relay URLs to subscribe and publish on. */
  relays: string[];
  /** Cashu mint URL. */
  mint: string;
  /** Provider's secret key (nsec or hex). Used to sign Nostr events and redeem HTLC. */
  privKey: string;
  /**
   * Optional: adapter for talking to the Cashu mint (used to redeem
   * the HTLC after the oracle releases the preimage). When omitted the
   * SDK builds one from `mint`.
   */
  cashuClient?: CashuClient;
  /**
   * Optional: pre-built relay client. When omitted the SDK builds one
   * from `relays` on each `serve()` call. Tests inject a mock here.
   */
  relayClient?: RelayClient;
  /** Optional: TLSN notary URL (only required for TLSN-based schemas). */
  notary?: string;
  /** Optional: how long to wait for a selection event after quoting (default: 60000 ms). */
  selectionTimeoutMs?: number;
  /** Optional: how long to wait for the oracle's preimage NIP-44 DM (default: 300000 ms / 5 min). */
  preimageTimeoutMs?: number;
  /** Optional: proof generators used to prefilter request schemas before calling the provider handler. */
  proofGenerators?: readonly ProofGenerator[];
}

/** Quote returned by a {@link ProviderHandler} when accepting a request. */
export interface ProviderQuote {
  /** Amount in sats the provider asks for. Must be ≤ request's maxAmountSats. */
  amountSats: number;
  /**
   * Lazy producer — invoked by the SDK only after the customer selects
   * this provider. Returns the data + proof that satisfy the request's
   * schema.
   */
  produce: () => Promise<{ data: unknown; proof: Uint8Array | string }>;
}

/**
 * Schema-side hook: produce a proof for the given predicate.
 *
 * Implementations live outside the SDK (e.g. @anchr/tlsn-toolkit,
 * @anchr/photo-verification). The SDK calls the producer registered for the
 * incoming request's schema URL; producers return whatever proof bytes
 * the schema document defines.
 */
export type SchemaProducer = (
  predicate: unknown,
  context: SchemaProducerContext,
) => Promise<{ data: unknown; proof: Uint8Array | string }>;

export interface SchemaProducerContext {
  /** TLSN notary URL configured on the provider, if any. */
  notary?: string;
  /** Customer's pubkey (hex). Useful for response encryption. */
  customerPubkey: string;
}

/** Provider-side proof generator selected by schema URL. */
export interface ProofGenerator {
  canHandle(schema: string): boolean;
  produce: SchemaProducer;
}

/** Oracle/customer-side verifier selected by schema URL. */
export interface VerifierAdapter {
  canHandle(schema: string): boolean;
  verify: SchemaVerifier;
}

export type SchemaVerifierRegistry =
  | Record<string, SchemaVerifier>
  | readonly VerifierAdapter[];

/**
 * Schema-side hook: verify a proof matches the predicate.
 *
 * Called by the customer locally after receiving the result, in addition
 * to the oracle's verification (defense in depth).
 */
export type SchemaVerifier = (
  proof: Uint8Array | string,
  predicate: unknown,
  data: unknown,
) => boolean | Promise<boolean>;

/** Options for a single customer.request() call. */
export interface RequestOptions {
  spec: Spec;
  payment: Payment;
  /** Source proofs to lock at the Cashu mint (from the customer's wallet). */
  sourceProofs: CashuProof[];
  /** Optional: target a specific provider pubkey instead of broadcasting. */
  provider?: string;
}

/** Handler signature passed to provider.serve(). */
export interface ProviderRequestEvent {
  /** Customer's pubkey (hex). */
  customerPubkey: string;
  /** The spec the customer wants fulfilled. */
  spec: Spec;
  /** The amount (in sats) the customer is willing to pay. */
  maxAmountSats: number;
  /** Oracle pubkey (hex) the customer designated for this query. */
  oraclePubkey: string;
  /** Matching proof generator, when the provider was configured with generator adapters. */
  proofGenerator?: ProofGenerator;
}

export type ProviderHandler = (
  request: ProviderRequestEvent,
) => Promise<ProviderQuote | null>;
