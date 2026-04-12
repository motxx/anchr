/**
 * NostrProofPublisher — publishes oracle attestations to Nostr relays.
 *
 * Implements the ProofDelivery interface. For "public" visibility queries,
 * builds a kind 30103 event with TLSNotary verified data and publishes it.
 *
 * Selective disclosure is handled at the TLSNotary protocol level:
 * the prover redacts sensitive header values before generating the
 * cryptographic presentation. The data published here is exactly
 * what was cryptographically verified — no post-hoc modification.
 */

import type { ProofDelivery, ProofPublishResult } from "../../application/proof-delivery";
import type { OracleAttestationRecord, ProofVisibility, Query } from "../../domain/types";
import type { NostrIdentity } from "./identity";
import { buildOracleAttestationEvent } from "./oracle-attestation";
import { publishEvent } from "./client";

export interface NostrProofPublisherConfig {
  identity: NostrIdentity;
  relayUrls?: string[];
}

export function createNostrProofPublisher(config: NostrProofPublisherConfig): ProofDelivery {
  return {
    async publish(
      query: Query,
      attestation: OracleAttestationRecord,
      visibility: ProofVisibility,
    ): Promise<ProofPublishResult | null> {
      if (visibility !== "public") return null;

      // Note: credential leakage in the *request* (Authorization, Cookie, etc.)
      // is prevented at the TLSNotary protocol level via selective disclosure
      // (--redact-sent-header). The revealed data here only contains the
      // *response* (revealed_body, revealed_headers) which doesn't contain
      // the requester's credentials, so no credential check is needed.

      // Build the attestation event with cryptographically verified data (as-is)
      const oracleAttestation = {
        oracle_id: attestation.oracle_id,
        query_id: query.id,
        passed: attestation.passed,
        checks: attestation.checks,
        failures: attestation.failures,
        attested_at: attestation.attested_at,
        tlsn_verified: attestation.tlsn_verified,
      };

      const event = buildOracleAttestationEvent(
        config.identity,
        query.nostr_event_id ?? query.id,
        query.id,
        oracleAttestation,
      );

      const result = await publishEvent(event, config.relayUrls);

      if (result.successes.length > 0) {
        console.error(
          `[proof-publisher] Attestation for query ${query.id} published to ${result.successes.length} relay(s)`,
        );
        return {
          event_id: event.id,
          relays: result.successes,
        };
      }

      console.error(
        `[proof-publisher] Failed to publish attestation for query ${query.id}: ${result.failures.join(", ")}`,
      );
      return null;
    },
  };
}
