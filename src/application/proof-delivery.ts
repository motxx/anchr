import type { OracleAttestationRecord, ProofVisibility, Query } from "../domain/types.ts";

export interface ProofPublishResult {
  event_id: string;
  relays: string[];
}

export interface ProofDelivery {
  /**
   * Returns null if visibility is "requester_only" or if publishing is skipped.
   */
  publish(
    query: Query,
    attestation: OracleAttestationRecord,
    visibility: ProofVisibility,
  ): Promise<ProofPublishResult | null>;
}
