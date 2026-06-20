import type {
  CustomerMeta,
  EscrowInfo,
  PaymentLockInfo,
  Query,
  QuorumConfig,
} from "../domain/types.ts";

export interface CreateQueryOptions {
  ttlMs?: number;
  ttlSeconds?: number;
  customerMeta?: CustomerMeta;
  payment_lock?: PaymentLockInfo;
  /** Acceptable oracle IDs. Empty/undefined leaves registry selection to the host. */
  oracleIds?: string[];
  /** Escrow info — when present, creates an escrow-mode (HTLC or P2PK+FROST) query. */
  escrow?: EscrowInfo;
  /** Nostr event ID of the kind 5300 Job Request. */
  nostrEventId?: string;
  /** Multi-oracle quorum config. When set with FROST, oracle_ids become FROST signers. */
  quorum?: QuorumConfig;
}

export interface SubmitQueryOutcome {
  ok: boolean;
  query: Query | null;
  message: string;
}

export interface CancelQueryOutcome {
  ok: boolean;
  message: string;
}

export interface QueryHooks {
  onCreated?: (query: Query) => void;
}

export interface HtlcOutcome {
  ok: boolean;
  message: string;
}
