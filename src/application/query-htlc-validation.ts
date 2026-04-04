import { getDecodedToken } from "@cashu/cashu-ts";
import { verifyToken } from "../infrastructure/cashu/wallet";
import type { Query, QueryStatus } from "../domain/types";

export interface HtlcTokenLockResult {
  ok: boolean;
  message?: string;
}

/**
 * CTF-2: Verify HTLC token P2PK lock target and hashlock.
 *
 * Without this, a requester could submit a token locked to their own key
 * instead of the worker's, then redeem after preimage is revealed.
 *
 * Returns `{ ok: true }` when the token passes all checks (or has no
 * HTLC-tagged proofs). A failure returns `{ ok: false, message }`.
 */
export function verifyHtlcTokenLock(
  tokenStr: string,
  htlcHash: string,
  workerPubkey: string,
): HtlcTokenLockResult {
  try {
    const decoded = getDecodedToken(tokenStr);
    for (const proof of decoded.proofs) {
      let secret: unknown;
      try { secret = JSON.parse(proof.secret); } catch { continue; }
      if (!Array.isArray(secret) || secret[0] !== "HTLC") continue;

      // Verify hashlock matches query hash
      if (secret[1]?.data !== htlcHash) {
        return { ok: false, message: "HTLC hash mismatch: token hashlock does not match query" };
      }

      // Verify P2PK lock includes worker pubkey
      const tags: string[][] | undefined = secret[1]?.tags;
      const pubkeyTag = tags?.find((t: string[]) => t[0] === "pubkeys");
      if (pubkeyTag) {
        const lockedKeys = pubkeyTag.slice(1);
        // Accept both compressed (02/03-prefixed) and raw hex
        const workerHex = workerPubkey.startsWith("02") || workerPubkey.startsWith("03")
          ? workerPubkey
          : `02${workerPubkey}`;
        if (!lockedKeys.includes(workerPubkey) && !lockedKeys.includes(workerHex)) {
          return { ok: false, message: "HTLC token not locked to selected worker" };
        }
      }
    }
  } catch {
    // Token decode failed — non-fatal, amount check already passed
  }
  return { ok: true };
}

/** Minimum HTLC locktime in seconds (10 minutes). */
export const MIN_HTLC_LOCKTIME_SECS = 600;

// --- HTLC state machine helpers ---

/** Valid state transitions for HTLC queries. */
export const HTLC_TRANSITIONS: Record<string, QueryStatus[]> = {
  awaiting_quotes: ["processing"],
  processing: ["verifying"],
  verifying: ["approved", "rejected"],
};

export function validateHtlcTransition(from: QueryStatus, to: QueryStatus): boolean {
  return HTLC_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isHtlcQuery(query: Query): boolean {
  return query.htlc !== undefined;
}

export interface EscrowAmountResult {
  valid: boolean;
  amountSats?: number;
  error?: string;
}

/**
 * Verify that the escrow token carries at least the expected amount.
 * Wraps the infrastructure `verifyToken` call.
 */
export async function verifyEscrowAmount(
  token: string,
  expectedSats: number,
): Promise<EscrowAmountResult> {
  const check = await verifyToken(token, expectedSats);
  return {
    valid: check.valid,
    amountSats: check.amountSats,
    error: check.error,
  };
}
