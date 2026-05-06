import type { BlossomKeyMap, EscrowType, Query, QueryResult, TlsnVerifiedData, VerificationDetail, VerificationFactor } from "./types.ts";

export interface OracleInfo {
  id: string;
  name: string;
  /** URL for external oracle APIs (undefined for built-in). */
  endpoint?: string;
  /** Fee in parts-per-million of bounty (e.g. 50_000 = 5%). */
  fee_ppm: number;
  supported_factors?: VerificationFactor[];
  supported_escrow_types?: EscrowType[];
  /** Minimum bounty this oracle accepts (sats). */
  min_bounty_sats?: number;
  /** Maximum bounty this oracle accepts (sats). */
  max_bounty_sats?: number;
  description?: string;
}

export interface OracleAttestation {
  oracle_id: string;
  query_id: string;
  passed: boolean;
  checks: string[];
  failures: string[];
  attested_at: number;
  tlsn_verified?: TlsnVerifiedData;
}

export interface Oracle {
  info: OracleInfo;
  verify(query: Query, result: QueryResult, blossomKeys?: BlossomKeyMap): Promise<OracleAttestation>;
}

export interface OracleVerificationDetail extends VerificationDetail {
  oracle_id: string;
  attested_at: number;
}

