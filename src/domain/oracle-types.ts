import type { BlossomKeyMap, EscrowType, Query, QueryResult, TlsnVerifiedData, VerificationDetail, VerificationFactor } from "./types";

/** Metadata about an oracle service. */
export interface OracleInfo {
  id: string;
  name: string;
  /** URL for external oracle APIs (undefined for built-in). */
  endpoint?: string;
  /** Fee in parts-per-million of bounty (e.g. 50_000 = 5%). */
  fee_ppm: number;
  /** Verification factors this oracle supports. */
  supported_factors?: VerificationFactor[];
  /** Escrow types this oracle supports. */
  supported_escrow_types?: EscrowType[];
  /** Minimum bounty this oracle accepts (sats). */
  min_bounty_sats?: number;
  /** Maximum bounty this oracle accepts (sats). */
  max_bounty_sats?: number;
  /** Human-readable description of the oracle service. */
  description?: string;
}

/** Signed result produced by an oracle after running deterministic checks. */
export interface OracleAttestation {
  oracle_id: string;
  query_id: string;
  passed: boolean;
  checks: string[];
  failures: string[];
  attested_at: number;
  /** Cryptographically verified TLSNotary data (if applicable). */
  tlsn_verified?: TlsnVerifiedData;
}

/** Oracle interface — any implementation (built-in, external HTTP, etc.) must satisfy this. */
export interface Oracle {
  info: OracleInfo;
  verify(query: Query, result: QueryResult, blossomKeys?: BlossomKeyMap): Promise<OracleAttestation>;
}

/** Extends VerificationDetail with oracle provenance. */
export interface OracleVerificationDetail extends VerificationDetail {
  oracle_id: string;
  attested_at: number;
}

/** Configuration for a FROST threshold oracle group. */
export interface ThresholdOracleConfig {
  /** Minimum signers required (t in t-of-n). */
  threshold: number;
  /** Total signers in the group. */
  total_signers: number;
  /** Each signer's Nostr pubkey (hex). */
  signer_pubkeys: string[];
  /** FROST DKG-generated group public key (BIP-340 x-only hex). */
  group_pubkey: string;
}
