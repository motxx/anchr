/**
 * Adapters from the request lifecycle (`Query` / `QueryResult`) to the
 * proof-verification contract. These live in `requests/` because they depend on
 * the `Query` aggregate; the pure engine `verifyProof` and the contract types
 * stay in `proofs/`. Keeping the `Query` coupling here means `proofs/` imports
 * nothing from `requests/`.
 */

import type { Query, QueryResult } from "../domain/types.ts";
import { verifyProof } from "../../proofs/mod.ts";
import type {
  VerificationDetail,
  VerificationInput,
  VerificationRequirement,
  VerifyProofOptions,
} from "../../proofs/mod.ts";

export function requestToRequirement(request: Query): VerificationRequirement {
  return {
    id: request.id,
    factors: request.verification_requirements,
    description: request.description,
    challenge_nonce: request.challenge_nonce,
    expected_gps: request.expected_gps,
    max_gps_distance_km: request.max_gps_distance_km,
    tlsn_requirements: request.tlsn_requirements,
  };
}

export function resultToVerificationInput(
  result: QueryResult,
): VerificationInput {
  return {
    attachments: result.attachments,
    gps: result.gps,
    tlsn_attestation: result.tlsn_attestation,
    tlsn_extension_result: result.tlsn_extension_result,
  };
}

/**
 * Verify a submitted result against its request. NIP-90 adapters use this
 * `Query`-shaped entry; standalone callers construct a `VerificationRequirement`
 * directly and call `verifyProof` from `@anchr/sdk/proofs`.
 */
export function verify(
  request: Query,
  result: QueryResult,
  options?: VerifyProofOptions,
): Promise<VerificationDetail> {
  return verifyProof(
    requestToRequirement(request),
    resultToVerificationInput(result),
    options,
  );
}
