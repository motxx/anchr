/** A specification of what the customer wants to buy. */
export interface Spec {
  /** Proof Schema URL identifying the proof format and predicate shape. */
  schema: string;
  /** Predicate whose shape is defined by the selected Proof Schema. */
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
  /**
   * Refund-locktime duration in seconds from selection time (default: 3600).
   * The protocol field `locktime_seconds` carries the resulting absolute Unix
   * timestamp in seconds, computed when the Provider is selected.
   */
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
  /** Proof Schema URL under which the proof was produced. */
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
