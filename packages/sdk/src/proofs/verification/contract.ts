/**
 * Proof-verification I/O contract: the policy a verifier checks, the evidence
 * it checks, and the verdict it returns.
 *
 * Owned by `proofs/` because `verifyProof` is a standalone proof engine usable
 * without a `Query`. These types depend only on the shared value-object leaf
 * (`values.ts`) and proofs-internal TLSN types, so the contract module is
 * cycle-free; the request lifecycle imports `VerificationDetail` from here in
 * one direction.
 */

import type {
  AttachmentRef,
  GpsCoord,
  VerificationFactor,
} from "../../values.ts";
import type {
  TlsnAttestation,
  TlsnRequirement,
  TlsnVerifiedData,
} from "../tlsn-types.ts";

/**
 * Query-independent verification policy. NIP-90 adapters derive this from a
 * signed request event; direct callers build it from authenticated requests.
 */
export interface VerificationRequirement {
  /** Stable identifier — used for integrity-store lookup keyed on the request. */
  id: string;
  factors: readonly VerificationFactor[];
  /** Free-text description of what the proof must establish. */
  description?: string;
  /** Per-request handwritten challenge string used by the nonce factor. */
  challenge_nonce?: string;
  expected_gps?: GpsCoord;
  /** Max allowed distance from expected_gps in km. Defaults to 50 inside the verifier. */
  max_gps_distance_km?: number;
  tlsn_requirements?: TlsnRequirement;
  /** SHA-256 over the encoded p2pk_frost escrow token, when token-bound signing is required. */
  escrow_token_hash?: string;
}

/** Query-independent shape of the evidence being verified. */
export interface VerificationInput {
  attachments: AttachmentRef[];
  gps?: GpsCoord;
  tlsn_attestation?: TlsnAttestation;
  tlsn_extension_result?: unknown;
}

export interface VerificationDetail {
  passed: boolean;
  checks: string[];
  failures: string[];
  /** Advisory warnings — informational, do not gate payment. */
  warnings?: string[];
  /** Cryptographically verified TLSNotary data (populated only for tlsn queries). */
  tlsn_verified?: TlsnVerifiedData;
}
