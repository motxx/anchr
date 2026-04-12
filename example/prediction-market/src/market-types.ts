/**
 * Prediction Market Types
 *
 * Core types for a Bitcoin-native prediction market built on
 * Cashu HTLC + Nostr + TLSNotary. No Ethereum, no bridges, no KYC.
 */

// --- Market ---

export interface PredictionMarket {
  /** Unique market identifier (hex, derived from Nostr event id). */
  id: string;
  /** Human-readable question, e.g. "Will BTC be above $100K on 2025-12-31?" */
  title: string;
  /** Extended description with context, rules, resolution criteria. */
  description: string;
  /** Market category for discovery and filtering. */
  category: "crypto" | "sports" | "politics" | "economics" | "custom";
  /** Nostr pubkey (hex) of the market creator. */
  creator_pubkey: string;

  // --- Resolution ---

  /** HTTPS URL to TLSNotary-prove for outcome determination. */
  resolution_url: string;
  /** Condition that determines YES vs NO from the resolution URL response. */
  resolution_condition: ResolutionCondition;
  /** Unix timestamp (seconds) — market closes and resolution can begin. */
  resolution_deadline: number;

  // --- Betting pools ---

  /** Total sats locked by YES bettors. */
  yes_pool_sats: number;
  /** Total sats locked by NO bettors. */
  no_pool_sats: number;
  /** Minimum bet size in sats (default: 1). */
  min_bet_sats: number;
  /** Maximum bet size in sats (0 = no limit). */
  max_bet_sats: number;
  /** Market creator fee in parts per million (e.g. 10000 = 1%). */
  fee_ppm: number;

  // --- Oracle ---

  /** Nostr pubkey (hex) of the oracle that will resolve this market. */
  oracle_pubkey: string;
  /** SHA-256 hash of the YES preimage. Oracle reveals if YES wins. */
  htlc_hash_yes: string;
  /** SHA-256 hash of the NO preimage. Oracle reveals if NO wins. */
  htlc_hash_no: string;
  /**
   * @deprecated Use htlc_hash_yes. Retained for backward compat.
   * When set, treated as alias for htlc_hash_yes.
   */
  htlc_hash?: string;

  // --- Nostr ---

  /** Nostr event ID of the market creation event. */
  nostr_event_id: string;
  /** Current market status. */
  status: MarketStatus;
}

export type MarketStatus =
  | "open"         // Accepting bets
  | "closed"       // Deadline passed, awaiting resolution
  | "resolving"    // Oracle is generating TLSNotary proof
  | "resolved_yes" // Oracle proved YES — preimage revealed
  | "resolved_no"  // Oracle proved NO — HTLC locktime expires
  | "expired";     // No resolution submitted before timeout

// --- Resolution conditions ---

export interface ResolutionCondition {
  /** How to evaluate the response body from the resolution URL. */
  type:
    | "price_above"     // JSON numeric value > threshold
    | "price_below"     // JSON numeric value < threshold
    | "contains_text"   // Body contains expected string
    | "jsonpath_equals" // JSONPath value === expected
    | "jsonpath_gt"     // JSONPath value > threshold
    | "jsonpath_lt";    // JSONPath value < threshold
  /** HTTPS URL to prove (same as market.resolution_url). */
  target_url: string;
  /** Dot-notation path into the JSON response (e.g. "best_bid", "data.price"). */
  jsonpath?: string;
  /** Numeric threshold for price/gt/lt conditions. */
  threshold?: number;
  /** Expected string for contains_text or jsonpath_equals. */
  expected_text?: string;
  /** Human-readable description of the condition. */
  description: string;
}

// --- Bets ---

export interface Bet {
  /** Unique bet identifier. */
  id: string;
  /** Market this bet belongs to. */
  market_id: string;
  /** Nostr pubkey (hex) of the bettor. */
  bettor_pubkey: string;
  /** Which side the bettor is on. */
  side: "yes" | "no";
  /** Amount wagered in sats. */
  amount_sats: number;
  /** Escrow token locked in cross-HTLC. */
  escrow_token: string;
  /** Unix timestamp (seconds) when the bet was placed. */
  timestamp: number;
}

// --- Matched pairs (N:M conditional swap specialization) ---

/** A matched bet pair — ConditionalSwap's SwapPair specialized for prediction markets. */
export interface MatchedBetPair {
  /** Unique pair identifier. */
  pair_id: string;
  /** Market this pair belongs to. */
  market_id: string;
  /** YES bettor's public key (hex). */
  yes_pubkey: string;
  /** NO bettor's public key (hex). */
  no_pubkey: string;
  /** Amount matched in sats. */
  amount_sats: number;
  /** Escrow token: YES bettor -> NO bettor (redeemable by NO if NO wins). */
  token_yes_to_no: string;
  /** Escrow token: NO bettor -> YES bettor (redeemable by YES if YES wins). */
  token_no_to_yes: string;
  /** Current status. */
  status: "pending" | "locked" | "settled_yes" | "settled_no" | "expired";
}

// --- Open orders ---

/** An open order waiting to be matched in the order book. */
export interface OpenOrder {
  /** Unique order identifier. */
  id: string;
  /** Market this order is for. */
  market_id: string;
  /** Bettor's public key (hex). */
  bettor_pubkey: string;
  /** Which side. */
  side: "yes" | "no";
  /** Total order amount in sats. */
  amount_sats: number;
  /** Remaining unmatched amount in sats. */
  remaining_sats: number;
  /** Unix timestamp (seconds) when the order was placed. */
  timestamp: number;
}

/** A match proposal from the order book. */
export interface MatchProposal {
  /** YES order being matched. */
  yes_order_id: string;
  /** NO order being matched. */
  no_order_id: string;
  /** Amount to match in sats. */
  amount_sats: number;
}

// --- Resolution ---

export interface MarketResolution {
  /** Market that was resolved. */
  market_id: string;
  /** Determined outcome. */
  outcome: "yes" | "no";
  /** Base64-encoded TLSNotary presentation proving the outcome. */
  tlsn_proof: string;
  /** Data extracted and verified from the TLSNotary proof. */
  verified_data: {
    /** TLS server name (e.g. "api.bitflyer.com"). */
    server_name: string;
    /** Response body revealed by selective disclosure. */
    revealed_body: string;
    /** Unix timestamp (seconds) of the TLSNotary session. */
    timestamp: number;
  };
  /** SHA-256 preimage — revealed only if outcome is YES. */
  preimage?: string;
}

// --- Nostr event kind for prediction markets ---

/**
 * NIP-90 DVM Job Request kind for prediction market events.
 * Uses the same kind range as Anchr queries (5300) with a
 * "t" tag of "anchr-market" for filtering.
 */
export const PREDICTION_MARKET_KIND = 30078;

/**
 * Nostr event content for a published prediction market.
 * Stored as JSON in the event content field.
 */
export interface MarketEventContent {
  title: string;
  description: string;
  category: PredictionMarket["category"];
  resolution_url: string;
  resolution_condition: ResolutionCondition;
  resolution_deadline: number;
  min_bet_sats: number;
  max_bet_sats: number;
  fee_ppm: number;
  oracle_pubkey: string;
  htlc_hash_yes: string;
  htlc_hash_no: string;
}

/**
 * Nostr event content for a bet placed on a market.
 */
export interface BetEventContent {
  market_id: string;
  side: "yes" | "no";
  amount_sats: number;
  escrow_token: string;
}

/**
 * Nostr event content for a market resolution.
 */
export interface ResolutionEventContent {
  market_id: string;
  outcome: "yes" | "no";
  tlsn_proof: string;
  verified_data: MarketResolution["verified_data"];
  preimage?: string;
}

// --- Oracle HTLC keypair ---

export interface OracleHtlcKeypair {
  /** SHA-256 hash of the preimage (hex). Published in the market. */
  hash: string;
  /** SHA-256 preimage (hex). Kept secret until YES resolution. */
  preimage: string;
}
