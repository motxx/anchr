/**
 * Proof-verification I/O contract: the policy a verifier checks, the evidence
 * it checks, and the verdict it returns.
 *
 * Owned by `proofs/` because `verifyProof` is a standalone proof engine usable
 * without a `Query`. These types depend only on the shared value-object leaf
 * (`values.ts`), so the contract module is cycle-free; the request lifecycle
 * imports `VerificationDetail` from here in one direction.
 */

import type { AttachmentRef, VerificationFactor } from "../../values.ts";
import type { SchemaUri } from "@anchr/protocol/schema";

/**
 * Query-independent verification policy. NIP-90 adapters derive this from a
 * signed request event; direct callers build it from authenticated requests.
 */
export interface VerificationRequirement {
  /** Stable identifier — used for integrity-store lookup keyed on the request. */
  id: string;
  /** Proof schema URI that owns requirement, evidence, checks, and verdict. */
  schema?: SchemaUri;
  factors: readonly VerificationFactor[];
  /** Free-text description of what the proof must establish. */
  description?: string;
  /** Per-request handwritten challenge string used by the nonce factor. */
  challenge_nonce?: string;
  schema_requirement?: unknown;
  /** SHA-256 over the encoded p2pk_frost escrow token, when token-bound signing is required. */
  escrow_token_hash?: string;
}

/** Query-independent shape of the evidence being verified. */
export interface VerificationInput {
  attachments: AttachmentRef[];
  schema_evidence?: unknown;
}

export interface VerificationDetail {
  passed: boolean;
  checks: string[];
  failures: string[];
  /** Advisory warnings — informational, do not gate payment. */
  warnings?: string[];
  schema_verdict?: unknown;
}
