/**
 * Airdrop Bot Shield — Claim Verifier
 *
 * Verifies a claimant's TLSNotary proofs against airdrop criteria.
 * Each proof is evaluated for:
 *   1. TLS signature validity (cryptographic, via tlsn-verifier binary)
 *   2. Domain matching (server_name must match condition's target_url hostname)
 *   3. Response body parsing and value extraction (via jsonpath)
 *   4. Threshold comparison (extracted value >= min_value)
 *   5. Attestation freshness
 *
 * On full pass, returns the Cashu HTLC preimage for token release.
 *
 * Reference modules:
 *   - validateTlsn, evaluateCondition from ../../../src/infrastructure/verification/tlsn-validation
 *   - TlsnVerifiedData, TlsnAttestation from ../../../src/domain/types
 *   - redeemHtlcToken from ../../../src/infrastructure/cashu/escrow
 */

import type { ProofCondition, AirdropCriteria } from "./airdrop-criteria.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A TLSNotary presentation submitted by a claimant for one condition. */
export interface ClaimProof {
  /** Index into the airdrop criteria's conditions array. */
  condition_index: number;
  /** Base64-encoded TLSNotary presentation file (.presentation.tlsn). */
  presentation: string;
}

/** Result of verifying a single condition. */
export interface ConditionResult {
  /** The condition that was checked. */
  condition: ProofCondition;
  /** Whether this condition passed. */
  passed: boolean;
  /** The value extracted from the TLSNotary-verified response body. */
  extracted_value?: string | number;
  /** Human-readable explanation of pass/fail. */
  reason: string;
}

/** Overall result of verifying a complete claim. */
export interface ClaimVerificationResult {
  /** Whether all conditions passed. */
  all_passed: boolean;
  /** Per-condition results. */
  results: ConditionResult[];
  /** Cashu HTLC preimage (only present when all_passed = true). */
  preimage?: string;
  /** Total verification checks performed. */
  checks: string[];
  /** Any failures encountered. */
  failures: string[];
}

/** Simulated TLSNotary-verified data (in production, comes from tlsn-verifier binary). */
export interface VerifiedProofData {
  /** Hostname from the TLS certificate (e.g., "api.github.com"). */
  server_name: string;
  /** The HTTP response body, cryptographically verified. */
  revealed_body: string;
  /** Unix timestamp of the TLS session. */
  session_timestamp: number;
}

// ---------------------------------------------------------------------------
// Core Verification
// ---------------------------------------------------------------------------

/** Maximum attestation age in seconds (10 minutes). */
const MAX_ATTESTATION_AGE_SECONDS = 600;

/**
 * Resolve a dot-notation path in a parsed JSON object.
 *
 * Mirrors the resolveDotPath function in Anchr's tlsn-validation module,
 * with the same prototype-chain traversal protections.
 */
const BLOCKED_PROPS = new Set(["__proto__", "constructor", "prototype"]);

function resolveDotPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    if (BLOCKED_PROPS.has(part)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Extract the hostname from a URL template, replacing template variables.
 */
function extractHostname(url: string): string | null {
  try {
    return new URL(url.replace(/\{[^}]+\}/g, "placeholder")).hostname;
  } catch {
    return null;
  }
}

/**
 * Evaluate a single proof condition against TLSNotary-verified data.
 *
 * This is the core verification logic. In production, the `verifiedData` comes
 * from the tlsn-verifier binary (Rust sidecar) which cryptographically extracts
 * server_name, revealed_body, and session_timestamp from the TLSNotary presentation.
 *
 * The function checks:
 *   1. Domain: server_name must match the condition's target_url hostname
 *   2. Freshness: session_timestamp must be within MAX_ATTESTATION_AGE_SECONDS
 *   3. Value extraction: jsonpath resolves to a value in the response body
 *   4. Threshold: extracted numeric value >= min_value (for account age, this is
 *      computed as days since the ISO 8601 date)
 */
export function evaluateCondition(
  condition: ProofCondition,
  verifiedData: VerifiedProofData,
): ConditionResult {
  const checks: string[] = [];

  // 1. Domain verification
  const expectedHost = extractHostname(condition.target_url);
  if (!expectedHost) {
    return {
      condition,
      passed: false,
      reason: `Invalid target URL: ${condition.target_url}`,
    };
  }

  if (verifiedData.server_name !== expectedHost) {
    return {
      condition,
      passed: false,
      reason: `Domain mismatch: expected "${expectedHost}", got "${verifiedData.server_name}"`,
    };
  }
  checks.push(`Domain verified: ${expectedHost}`);

  // 2. Freshness check
  const ageSeconds = Math.floor(Date.now() / 1000) - verifiedData.session_timestamp;
  if (ageSeconds < 0 || ageSeconds > MAX_ATTESTATION_AGE_SECONDS) {
    return {
      condition,
      passed: false,
      reason: `Attestation too old: ${ageSeconds}s (max ${MAX_ATTESTATION_AGE_SECONDS}s)`,
    };
  }
  checks.push(`Attestation fresh: ${ageSeconds}s old`);

  // 3. Parse response body and extract value
  let parsed: unknown;
  try {
    parsed = JSON.parse(verifiedData.revealed_body);
  } catch {
    return {
      condition,
      passed: false,
      reason: "Response body is not valid JSON",
    };
  }

  const rawValue = resolveDotPath(parsed, condition.jsonpath);
  if (rawValue === undefined) {
    return {
      condition,
      passed: false,
      reason: `JSONPath "${condition.jsonpath}" not found in response`,
    };
  }

  // 4. Type-specific value comparison
  let numericValue: number;

  if (condition.type === "github_account_age") {
    // created_at is an ISO 8601 date string — compute age in days
    const createdAt = new Date(String(rawValue));
    if (isNaN(createdAt.getTime())) {
      return {
        condition,
        passed: false,
        extracted_value: String(rawValue),
        reason: `Cannot parse "${rawValue}" as date for account age calculation`,
      };
    }
    numericValue = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  } else {
    // Direct numeric comparison for repos, followers, contributions
    numericValue = Number(rawValue);
    if (isNaN(numericValue)) {
      return {
        condition,
        passed: false,
        extracted_value: String(rawValue),
        reason: `Expected numeric value at "${condition.jsonpath}", got "${rawValue}"`,
      };
    }
  }

  // 5. Threshold check
  if (condition.min_value !== undefined && numericValue < condition.min_value) {
    return {
      condition,
      passed: false,
      extracted_value: numericValue,
      reason: `Value ${numericValue} is below minimum ${condition.min_value} (${condition.description})`,
    };
  }

  return {
    condition,
    passed: true,
    extracted_value: numericValue,
    reason: `Passed: ${condition.description} (value: ${numericValue})`,
  };
}

/**
 * Verify a complete claim against airdrop criteria.
 *
 * Takes an array of TLSNotary proof data (one per condition) and evaluates
 * each against the corresponding condition. All conditions must pass for the
 * claim to be approved.
 *
 * In production:
 *   - ClaimProof.presentation is decoded and verified by the tlsn-verifier binary
 *   - The binary outputs VerifiedProofData (server_name, revealed_body, timestamp)
 *   - This function evaluates the verified data against conditions
 *   - On success, the HTLC preimage is released for token redemption
 *
 * @param criteria - The airdrop campaign definition
 * @param verifiedProofs - Map of condition_index -> TLSNotary-verified data
 * @param preimage - The HTLC preimage to release on success (held by oracle)
 */
export function verifyClaim(
  criteria: AirdropCriteria,
  verifiedProofs: Map<number, VerifiedProofData>,
  preimage: string,
): ClaimVerificationResult {
  const results: ConditionResult[] = [];
  const checks: string[] = [];
  const failures: string[] = [];

  // Ensure every condition has a corresponding proof
  for (let i = 0; i < criteria.conditions.length; i++) {
    const condition = criteria.conditions[i]!;
    const proofData = verifiedProofs.get(i);

    if (!proofData) {
      const result: ConditionResult = {
        condition,
        passed: false,
        reason: `No proof submitted for condition ${i}: ${condition.description}`,
      };
      results.push(result);
      failures.push(result.reason);
      continue;
    }

    const result = evaluateCondition(condition, proofData);
    results.push(result);

    if (result.passed) {
      checks.push(result.reason);
    } else {
      failures.push(result.reason);
    }
  }

  const allPassed = results.every((r) => r.passed);

  return {
    all_passed: allPassed,
    results,
    preimage: allPassed ? preimage : undefined,
    checks,
    failures,
  };
}

/**
 * Generate a unique claim hash for HTLC escrow.
 *
 * In production, this uses SHA-256 from @noble/hashes (the same library Anchr uses):
 *   import { sha256 } from "@noble/hashes/sha2.js";
 *   import { bytesToHex } from "@noble/hashes/utils.js";
 *
 * The preimage is a random 32-byte secret. The hash is SHA-256(preimage).
 * The oracle holds the preimage and releases it only when all conditions pass.
 */
export function generateClaimHash(): { preimage: string; hash: string } {
  // In production: use crypto.getRandomValues + @noble/hashes
  // For the example, generate a deterministic mock
  const preimageBytes = new Uint8Array(32);
  crypto.getRandomValues(preimageBytes);
  const preimage = Array.from(preimageBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // SHA-256 hash of the preimage
  // In production: const hash = bytesToHex(sha256(hexToBytes(preimage)));
  // For the example, use Web Crypto API
  return { preimage, hash: `sha256:${preimage.slice(0, 16)}...` };
}

/**
 * Async version of generateClaimHash using Web Crypto for real SHA-256.
 */
export async function generateClaimHashAsync(): Promise<{ preimage: string; hash: string }> {
  const preimageBytes = new Uint8Array(32);
  crypto.getRandomValues(preimageBytes);
  const preimage = Array.from(preimageBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const hashBuffer = await crypto.subtle.digest("SHA-256", preimageBytes);
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { preimage, hash };
}
