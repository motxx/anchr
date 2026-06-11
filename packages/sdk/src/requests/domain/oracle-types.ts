import type { BlossomKeyMap, VerificationFactor } from "../../values.ts";
import type {
  EscrowType,
  Query,
  QueryResult,
  VerificationDetail,
} from "./types.ts";
import type { TlsnVerifiedData } from "../../proofs/mod.ts";

export interface OracleInfo {
  id: string;
  name: string;
  /** URL for external oracle APIs (undefined for built-in). */
  endpoint?: string;
  /** Fee in parts-per-million of the Payment Lock amount (e.g. 50_000 = 5%). */
  fee_ppm: number;
  supported_factors?: VerificationFactor[];
  supported_escrow_types?: EscrowType[];
  /** Minimum Payment Lock amount this oracle accepts (sats). */
  min_amount_sats?: number;
  /** Maximum Payment Lock amount this oracle accepts (sats). */
  max_amount_sats?: number;
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
  verify(
    query: Query,
    result: QueryResult,
    blossomKeys?: BlossomKeyMap,
  ): Promise<OracleAttestation>;
}

export interface OracleVerificationDetail extends VerificationDetail {
  oracle_id: string;
  attested_at: number;
}
