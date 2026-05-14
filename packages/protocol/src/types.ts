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
  /** Maximum amount in sats the customer will pay for a single offer. */
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

/** An offer received from a provider in response to a request. */
export interface Offer {
  /** Provider's hex pubkey. */
  providerPubkey: string;
  /** Offered amount in sats. */
  amountSats: number;
  /** Provider's offer event id (for selection). */
  offerEventId: string;
  /** Local timestamp when the offer was received. */
  receivedAt: number;
}

/** Offer returned by a Provider handler when accepting a request. */
export interface ProviderOffer {
  /** Amount in sats the provider asks for. Must be <= request's maxAmountSats. */
  amountSats: number;
  produce: () => Promise<{ data: unknown; proof: Uint8Array | string }>;
}

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

export type SchemaVerifier = (
  proof: Uint8Array | string,
  predicate: unknown,
  data: unknown,
) => boolean | Promise<boolean>;

/** Oracle/customer-side verifier selected by schema URL. */
export interface VerifierAdapter {
  canHandle(schema: string): boolean;
  verify: SchemaVerifier;
}

/** Handler-visible request payload for a Provider. */
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
) => Promise<ProviderOffer | null>;
