/**
 * SDK-local Oracle↔Provider release DM payload shapes that ride next to the
 * canonical wire contract (`@anchr/protocol/events`). The Oracle-readable
 * result payload in `oracle_payload` tags is owned by the canonical
 * `parseOracleQueryResponseEvent`.
 */

/** Preimage delivery via NIP-44 DM (kind 4). */
export interface PreimageDMPayload {
  type: "preimage";
  query_id: string;
  request_event_id: string;
  preimage: string;
}

/** Rejection notice via NIP-44 DM (kind 4). */
export interface RejectionDMPayload {
  type: "rejection";
  query_id: string;
  reason: string;
}

/** FROST group signature delivery via NIP-44 DM (kind 4). */
export interface FrostSignatureDMPayload {
  type: "frost_signature";
  query_id: string;
  /** BIP-340 Schnorr signature hex values, ordered by token proof. */
  group_signature: string[];
  /** FROST group public key for verification. */
  group_pubkey: string;
}

export type OracleDMPayload =
  | PreimageDMPayload
  | RejectionDMPayload
  | FrostSignatureDMPayload;

export { buildOracleAnnouncementEvent } from "./event-builders.ts";
