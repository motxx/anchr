/**
 * Supply Chain Proof — Type definitions
 *
 * Cryptographic supply chain records backed by GPS + C2PA + TLSNotary + Cashu HTLC.
 * Each step in a product's journey from origin to retail is independently verifiable.
 *
 * Anchr domain types referenced:
 *   - GpsCoord          (src/domain/types.ts)
 *   - TlsnAttestation   (src/domain/types.ts)
 *   - TlsnVerifiedData  (src/domain/types.ts)
 *   - HtlcInfo          (src/domain/types.ts)
 */

// ---------------------------------------------------------------------------
// Core supply chain step
// ---------------------------------------------------------------------------

/** The progression stages a product moves through. */
export type StepType =
  | "origin"
  | "processing"
  | "storage"
  | "transport"
  | "customs"
  | "retail";

/** A single actor (person, company, or machine) in the supply chain. */
export interface Actor {
  name: string;
  /** Nostr hex public key. */
  pubkey: string;
}

/** A named geographic coordinate. */
export interface Location {
  lat: number;
  lon: number;
  name: string;
}

/** Proof types that can accompany a supply chain step. */
export type StepProofType =
  | "gps_photo"
  | "tlsn_api"
  | "c2pa_media"
  | "temperature_log";

/** A single proof attached to a step. */
export interface StepProof {
  type: StepProofType;
  /**
   * Proof payload. Structure depends on `type`:
   *   - gps_photo:       { lat, lon, photo_hash, c2pa_manifest? }
   *   - tlsn_api:        { server_name, revealed_body, session_timestamp }
   *   - c2pa_media:      { signer, signature_time, assertions }
   *   - temperature_log: { readings: Array<{ celsius, timestamp }>, device_id }
   */
  data: Record<string, unknown>;
  verified: boolean;
  verification_details?: string;
}

/**
 * One step in a supply chain.
 * Steps form a singly-linked list via `previous_step_id`.
 */
export interface SupplyChainStep {
  id: string;
  product_id: string;
  step_type: StepType;
  actor: Actor;
  location: Location;
  /** Unix timestamp (seconds) when the step occurred. */
  timestamp: number;
  proofs: StepProof[];
  /** ID of the immediately preceding step. Absent for the origin step. */
  previous_step_id?: string;
  /** Nostr event ID that records this step on the decentralized log. */
  nostr_event_id?: string;
}

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export type ProductCategory =
  | "coffee"
  | "pharmaceutical"
  | "luxury"
  | "organic_produce";

export interface SupplyChainProduct {
  id: string;
  name: string;
  category: ProductCategory;
  steps: SupplyChainStep[];
  /** Rules that each step type must satisfy before it is considered valid. */
  verification_requirements: StepRequirement[];
}

// ---------------------------------------------------------------------------
// Verification requirements
// ---------------------------------------------------------------------------

/** Comparison operators for requirement conditions. */
export type ConditionOperator = "eq" | "gt" | "lt" | "within_km";

export interface RequirementCondition {
  /** Dot-path into the proof's `data` object (e.g. "celsius", "lat"). */
  field: string;
  operator: ConditionOperator;
  value: string | number;
}

export interface RequiredProof {
  proof_type: StepProofType;
  conditions: RequirementCondition[];
}

export interface PaymentCondition {
  /** Amount locked in Cashu HTLC for this step. */
  amount_sats: number;
  /** If true, the HTLC preimage is released only after oracle verification. */
  release_on_verification: boolean;
}

export interface StepRequirement {
  step_type: StepType;
  required_proofs: RequiredProof[];
  payment_condition?: PaymentCondition;
}

// ---------------------------------------------------------------------------
// Verification report
// ---------------------------------------------------------------------------

export type StepVerdict = "pass" | "fail" | "skip";

export interface StepVerificationResult {
  step_id: string;
  step_type: StepType;
  verdict: StepVerdict;
  proof_results: ProofCheckResult[];
  issues: string[];
}

export interface ProofCheckResult {
  proof_type: StepProofType;
  passed: boolean;
  details: string;
}

export interface ChainVerificationReport {
  product_id: string;
  product_name: string;
  /** Overall trust score 0-100. */
  trust_score: number;
  chain_intact: boolean;
  time_ordered: boolean;
  step_results: StepVerificationResult[];
  /** Total sats conditionally released across all steps. */
  total_sats_released: number;
  verified_at: number;
}
