/**
 * FROST P2PK Escrow Provider -- NUT-11 P2PK 2-of-2 (Worker, group_pubkey).
 *
 * Instead of HTLC hashlock + preimage, the FROST oracle group produces
 * a BIP-340 Schnorr signature that serves as the second key in a
 * 2-of-2 P2PK lock. The Mint sees a standard NUT-11 P2PK token --
 * no Mint changes required.
 *
 * Spending requires:
 *   1. Worker's signature (Worker's private key)
 *   2. FROST group signature (threshold signers cooperate)
 *
 * Refund after locktime:
 *   Requester's signature (single refund key)
 */

import {
  P2PKBuilder,
  type Proof,
  type P2PKOptions,
} from "@cashu/cashu-ts";
import type { EscrowProvider } from "../../application/escrow-port.ts";
import {
  getWalletAndConfig,
  encodeProofs,
  loadAndSend,
  computeNetAmount,
} from "./escrow-helpers.ts";

export interface FrostEscrowConfig {
  /** FROST group public key (BIP-340 x-only hex). */
  groupPubkey: string;
  /** Source proofs resolver. */
  sourceProofsResolver?: (amount: number) => Promise<Proof[]>;
}

/**
 * Build P2PK options for FROST escrow: 2-of-2 (Worker + group_pubkey).
 */
export function buildFrostP2PKOptions(
  workerPubkey: string,
  groupPubkey: string,
  requesterRefundPubkey: string,
  locktimeSeconds: number,
): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey([workerPubkey, groupPubkey])
    .requireLockSignatures(2)
    .lockUntil(locktimeSeconds)
    .addRefundPubkey(requesterRefundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

export function createFrostEscrowProvider(
  config: FrostEscrowConfig,
): EscrowProvider {
  const tokenMap = new Map<string, { token: string; proofs: Proof[] }>();
  let refCounter = 0;

  return {
    async createHold(params) {
      if (!config.sourceProofsResolver) return null;

      const ctx = await getWalletAndConfig();
      if (!ctx) return null;

      const sourceProofs = await config.sourceProofsResolver(params.amount_sats);

      try {
        // Phase 1: Plain proofs (no lock yet, same as HTLC Phase 1)
        const send = await loadAndSend(ctx.wallet, params.amount_sats, sourceProofs);
        const token = encodeProofs(ctx.config.mintUrl, send);
        const ref = `frost_p2pk_${++refCounter}`;
        tokenMap.set(ref, { token, proofs: send });
        return { escrow_ref: ref };
      } catch (error) {
        console.error("[frost-escrow] Failed to create hold:", error instanceof Error ? error.message : error);
        return null;
      }
    },

    async bindWorker(escrow_ref, worker_pubkey) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return null;

      const ctx = await getWalletAndConfig();
      if (!ctx) return null;

      const locktimeSeconds = Math.floor(Date.now() / 1000) + 3600; // default 1h

      const p2pkOptions = buildFrostP2PKOptions(
        worker_pubkey,
        config.groupPubkey,
        "", // requester pubkey would come from the escrow context
        locktimeSeconds,
      );

      try {
        const amountSats = computeNetAmount(ctx.wallet, entry.proofs);
        if (amountSats === null) return null;

        const send = await loadAndSend(ctx.wallet, amountSats, entry.proofs, p2pkOptions);
        const token = encodeProofs(ctx.config.mintUrl, send);
        const newRef = `frost_p2pk_${++refCounter}`;
        tokenMap.set(newRef, { token, proofs: send });
        tokenMap.delete(escrow_ref);
        return { escrow_ref: newRef };
      } catch (error) {
        console.error("[frost-escrow] Failed to bind worker:", error instanceof Error ? error.message : error);
        return null;
      }
    },

    async verify(escrow_ref, expected_sats) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return { valid: false, error: "Unknown escrow reference" };

      // Import dynamically to avoid circular dependency
      const { verifyEscrowAmount } = await import("../../application/query-htlc-validation.ts");
      const result = await verifyEscrowAmount(entry.token, expected_sats);
      return {
        valid: result.valid,
        amount_sats: result.amountSats,
        error: result.error,
      };
    },

    async verifyLock(escrow_ref, _payment_hash, worker_pubkey) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return { ok: false, message: "Unknown escrow reference" };

      // For P2PK+FROST, verify that the token has the correct P2PK lock
      // (Worker + group_pubkey as required signers)
      try {
        const { getDecodedToken } = await import("@cashu/cashu-ts");
        const decoded = getDecodedToken(entry.token);
        for (const proof of decoded.proofs) {
          const secret = JSON.parse(proof.secret);
          if (!Array.isArray(secret) || secret[0] !== "P2PK") {
            return { ok: false, message: "Not a P2PK proof" };
          }
          // Verify the lock pubkeys include both worker and group
          const tags: string[][] = secret[1]?.tags ?? [];
          const pubkeys = tags.find((t: string[]) => t[0] === "pubkeys");
          if (!pubkeys) {
            return { ok: false, message: "No pubkeys tag in P2PK proof" };
          }
          const hasWorker = pubkeys.slice(1).some((pk: string) =>
            pk === worker_pubkey || pk === `02${worker_pubkey}` || pk === `03${worker_pubkey}`
          );
          const hasGroup = pubkeys.slice(1).some((pk: string) =>
            pk === config.groupPubkey || pk === `02${config.groupPubkey}` || pk === `03${config.groupPubkey}`
          );
          if (!hasWorker) return { ok: false, message: "Worker pubkey not in P2PK lock" };
          if (!hasGroup) return { ok: false, message: "Group pubkey not in P2PK lock" };
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, message: `P2PK verification failed: ${error instanceof Error ? error.message : error}` };
      }
    },

    async settle(_escrow_ref, _preimage) {
      // For FROST, settlement happens when Worker has both:
      // 1. Worker's own signature
      // 2. FROST group signature
      // This is handled client-side, not by the provider.
      return { settled: true };
    },

    async cancel(escrow_ref) {
      const deleted = tokenMap.delete(escrow_ref);
      return { cancelled: deleted };
    },
  };
}
