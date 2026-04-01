import type { BlossomKeyMap, Query, QueryResult, TlsnVerifiedData, VerificationDetail } from "./types";

/** Metadata about an oracle service. */
export interface OracleInfo {
  id: string;
  name: string;
  /** URL for external oracle APIs (undefined for built-in). */
  endpoint?: string;
  /** Fee in parts-per-million of bounty (e.g. 50_000 = 5%). */
  fee_ppm: number;
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
