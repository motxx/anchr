/**
 * Oracle attestation events for Anchr.
 *
 * Kind 30103 - OracleAttestation: published by oracle after verification.
 * Publicly verifiable — anyone can check the oracle's signature and
 * reproduce the deterministic verification checks.
 */

import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import type { NostrIdentity } from "./identity";
import type { OracleAttestation } from "../../domain/oracle-types";

export const ANCHR_ORACLE_ATTESTATION = 30103;

export interface OracleAttestationPayload {
  oracle_id: string;
  query_id: string;
  passed: boolean;
  checks: string[];
  failures: string[];
  attested_at: number;
}

/**
 * Build an OracleAttestation event.
 * Published by the oracle after running deterministic verification.
 * Content is plaintext JSON — attestations are public and verifiable.
 */
export function buildOracleAttestationEvent(
  identity: NostrIdentity,
  queryEventId: string,
  responseEventId: string,
  attestation: OracleAttestation,
): VerifiedEvent {
  const payload: OracleAttestationPayload = {
    oracle_id: attestation.oracle_id,
    query_id: attestation.query_id,
    passed: attestation.passed,
    checks: attestation.checks,
    failures: attestation.failures,
    attested_at: attestation.attested_at,
  };

  const template: EventTemplate = {
    kind: ANCHR_ORACLE_ATTESTATION,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", queryEventId],
      ["e", responseEventId],
      ["d", attestation.query_id],
      ["t", "anchr"],
      ["t", "attestation"],
      ["result", attestation.passed ? "pass" : "fail"],
    ],
    content: JSON.stringify(payload),
  };

  return finalizeEvent(template, identity.secretKey);
}

/**
 * Parse an OracleAttestation event.
 */
export function parseOracleAttestationPayload(content: string): OracleAttestationPayload {
  return JSON.parse(content) as OracleAttestationPayload;
}

/**
 * Convert an OracleAttestationPayload to an OracleAttestation.
 */
export function toOracleAttestation(payload: OracleAttestationPayload): OracleAttestation {
  return {
    oracle_id: payload.oracle_id,
    query_id: payload.query_id,
    passed: payload.passed,
    checks: payload.checks,
    failures: payload.failures,
    attested_at: payload.attested_at,
  };
}
