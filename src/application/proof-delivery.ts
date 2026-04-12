/**
 * ProofDelivery — application-layer port for publishing attestation proofs.
 *
 * When visibility is "public", the attestation (with redacted TLSNotary data)
 * is published to Nostr relays as a kind 30103 event.
 * When visibility is "requester_only", proof delivery is handled via
 * existing NIP-44 DM and this interface returns null.
 */

import type { OracleAttestationRecord, ProofVisibility, Query } from "../domain/types";

/** Result of a proof publish attempt. */
export interface ProofPublishResult {
  /** Nostr event ID of the published attestation. */
  event_id: string;
  /** Relay URLs that accepted the event. */
  relays: string[];
}

/** Interface for publishing attestation proofs. */
export interface ProofDelivery {
  /**
   * Publish an attestation for a query.
   * Returns null if visibility is "requester_only" or if publishing is skipped.
   */
  publish(
    query: Query,
    attestation: OracleAttestationRecord,
    visibility: ProofVisibility,
  ): Promise<ProofPublishResult | null>;
}
