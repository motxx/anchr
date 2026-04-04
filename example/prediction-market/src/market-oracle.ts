/**
 * Prediction Market Oracle — Resolution Logic
 *
 * The oracle resolves markets by generating a TLSNotary proof from an
 * authoritative URL and evaluating the resolution condition against the
 * cryptographically verified response body.
 *
 * If the outcome is YES, the oracle reveals the HTLC preimage so YES
 * bettors can redeem their Cashu tokens. If NO, the HTLC locktime
 * expires and tokens refund to a pool that pays NO bettors.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import type {
  PredictionMarket,
  MarketResolution,
  ResolutionCondition,
  OracleHtlcKeypair,
} from "./market-types.ts";

// --- HTLC key generation ---

/**
 * Generate a fresh HTLC hash/preimage pair for a new market.
 *
 * The oracle keeps the preimage secret. The hash is published in the
 * market event. If the outcome is YES, the oracle reveals the preimage
 * so YES bettors can redeem their HTLC-locked Cashu tokens.
 */
export function createMarketHtlc(): OracleHtlcKeypair {
  const preimageBytes = randomBytes(32);
  const hashBytes = sha256(preimageBytes);
  return {
    preimage: bytesToHex(preimageBytes),
    hash: bytesToHex(hashBytes),
  };
}

/**
 * Verify that a preimage matches a hash.
 */
export function verifyPreimage(preimage: string, expectedHash: string): boolean {
  const hashBytes = sha256(hexToBytes(preimage));
  return bytesToHex(hashBytes) === expectedHash;
}

// --- Market resolution ---

/**
 * Resolve a prediction market using a TLSNotary proof.
 *
 * Steps:
 *   1. Parse the TLSNotary presentation to extract verified data
 *   2. Verify the server name matches the resolution URL domain
 *   3. Evaluate the resolution condition against the response body
 *   4. If YES: attach the preimage for HTLC redemption
 *   5. If NO: no preimage — HTLC locktime expires, NO bettors refund
 *
 * In production, step 1 uses the TLSNotary verifier library to
 * cryptographically verify the presentation. This demo simulates
 * the verification with a pre-parsed response body.
 */
export function resolveMarket(
  market: PredictionMarket,
  tlsnProof: string,
  verifiedServerName: string,
  verifiedBody: string,
  verifiedTimestamp: number,
  oraclePreimage: string,
): MarketResolution {
  // 1. Verify server name matches resolution URL
  const expectedDomain = new URL(market.resolution_url).hostname;
  if (verifiedServerName !== expectedDomain) {
    throw new OracleError(
      `Server name mismatch: expected "${expectedDomain}", got "${verifiedServerName}"`,
    );
  }

  // 2. Verify the proof timestamp is reasonable (within 10 minutes of resolution)
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 600; // 10 minutes
  if (now - verifiedTimestamp > maxAge) {
    throw new OracleError(
      `TLSNotary proof too old: ${now - verifiedTimestamp}s (max ${maxAge}s)`,
    );
  }

  // 3. Verify the preimage matches the market's HTLC hash
  if (!verifyPreimage(oraclePreimage, market.htlc_hash)) {
    throw new OracleError("Preimage does not match market HTLC hash");
  }

  // 4. Evaluate the resolution condition
  const conditionMet = evaluateCondition(market.resolution_condition, verifiedBody);

  // 5. Build resolution
  const outcome = conditionMet ? "yes" : "no";

  return {
    market_id: market.id,
    outcome,
    tlsn_proof: tlsnProof,
    verified_data: {
      server_name: verifiedServerName,
      revealed_body: verifiedBody,
      timestamp: verifiedTimestamp,
    },
    // Only reveal preimage if YES wins
    preimage: outcome === "yes" ? oraclePreimage : undefined,
  };
}

// --- Condition evaluation ---

/**
 * Evaluate a resolution condition against a verified response body.
 *
 * @returns true if the condition is met (YES outcome), false otherwise (NO outcome)
 */
export function evaluateCondition(
  condition: ResolutionCondition,
  body: string,
): boolean {
  switch (condition.type) {
    case "contains_text":
      return evaluateContainsText(condition, body);

    case "price_above":
    case "jsonpath_gt":
      return evaluateJsonpathComparison(condition, body, "gt");

    case "price_below":
    case "jsonpath_lt":
      return evaluateJsonpathComparison(condition, body, "lt");

    case "jsonpath_equals":
      return evaluateJsonpathEquals(condition, body);

    default:
      throw new OracleError(`Unknown condition type: ${condition.type}`);
  }
}

// --- Condition helpers ---

function evaluateContainsText(
  condition: ResolutionCondition,
  body: string,
): boolean {
  if (!condition.expected_text) {
    throw new OracleError("contains_text condition requires expected_text");
  }
  return body.includes(condition.expected_text);
}

function evaluateJsonpathComparison(
  condition: ResolutionCondition,
  body: string,
  op: "gt" | "lt",
): boolean {
  if (condition.threshold === undefined) {
    throw new OracleError(`${condition.type} condition requires threshold`);
  }
  const value = extractJsonValue(body, condition.jsonpath);
  if (typeof value !== "number") {
    throw new OracleError(
      `Expected numeric value at path "${condition.jsonpath}", got ${typeof value}`,
    );
  }
  return op === "gt" ? value > condition.threshold : value < condition.threshold;
}

function evaluateJsonpathEquals(
  condition: ResolutionCondition,
  body: string,
): boolean {
  if (condition.expected_text === undefined) {
    throw new OracleError("jsonpath_equals condition requires expected_text");
  }
  const value = extractJsonValue(body, condition.jsonpath);
  return String(value) === condition.expected_text;
}

/**
 * Extract a value from a JSON body using a dot-notation path.
 *
 * Supports simple paths like "best_bid", "data.price", "results[0].value".
 * This is intentionally simple — a production implementation would use
 * a proper JSONPath library.
 */
export function extractJsonValue(
  body: string,
  path?: string,
): unknown {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new OracleError("Response body is not valid JSON");
  }

  if (!path) return data;

  const segments = path.split(".");
  let current: unknown = data;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      throw new OracleError(`Path "${path}" not found: null at "${segment}"`);
    }

    // Handle array indexing: "results[0]"
    const arrayMatch = segment.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, key, indexStr] = arrayMatch;
      current = (current as Record<string, unknown>)[key!];
      if (!Array.isArray(current)) {
        throw new OracleError(`Path "${path}": "${key}" is not an array`);
      }
      current = current[Number(indexStr)];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return current;
}

// --- Oracle fee calculation ---

/**
 * Calculate the oracle's resolution fee from the total pool.
 *
 * The oracle takes a flat percentage (typically 0.5-1%) for resolving
 * the market. This incentivizes timely, accurate resolution.
 *
 * @param totalPoolSats Combined YES + NO pool
 * @param feePpm Fee in parts per million (e.g. 5000 = 0.5%)
 */
export function calculateOracleFee(totalPoolSats: number, feePpm: number): number {
  return Math.ceil((totalPoolSats * feePpm) / 1_000_000);
}

/**
 * Calculate payouts for winning bettors.
 *
 * Winner's share = (bet / winning_pool) * (total_pool - oracle_fee - creator_fee)
 *
 * Example: Alice bets 100 sats YES, Bob bets 100 sats NO.
 * YES wins. Oracle fee = 1 sat (0.5%), Creator fee = 1 sat (0.5%).
 * Alice gets: (100/100) * (200 - 1 - 1) = 198 sats. Net profit: +98 sats.
 */
export function calculatePayouts(
  market: PredictionMarket,
  outcome: "yes" | "no",
  bets: Array<{ side: "yes" | "no"; amount_sats: number; bettor_pubkey: string }>,
  oracleFeePpm: number,
): Array<{ bettor_pubkey: string; payout_sats: number }> {
  const totalPool = market.yes_pool_sats + market.no_pool_sats;
  const oracleFee = calculateOracleFee(totalPool, oracleFeePpm);
  const creatorFee = calculateOracleFee(totalPool, market.fee_ppm);
  const payablePool = totalPool - oracleFee - creatorFee;

  const winningBets = bets.filter((b) => b.side === outcome);
  const winningPool = outcome === "yes" ? market.yes_pool_sats : market.no_pool_sats;

  if (winningPool === 0) return [];

  return winningBets.map((bet) => ({
    bettor_pubkey: bet.bettor_pubkey,
    payout_sats: Math.floor((bet.amount_sats / winningPool) * payablePool),
  }));
}

// --- Error ---

export class OracleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleError";
  }
}
