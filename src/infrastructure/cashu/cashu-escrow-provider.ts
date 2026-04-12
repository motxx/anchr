/**
 * CashuEscrowProvider — wraps existing Cashu HTLC escrow as an EscrowProvider.
 *
 * Thin adapter: delegates to escrow.ts functions without changing any existing logic.
 */

import type { EscrowProvider } from "../../application/escrow-port";
import { verifyEscrowAmount, verifyHtlcTokenLock } from "../../application/query-htlc-validation";
import { createHtlcToken, swapHtlcBindWorker, type EscrowToken } from "./escrow";
import { getDecodedToken } from "@cashu/cashu-ts";

export interface CashuEscrowProviderConfig {
  /** Source Cashu proofs for createHold (if known ahead of time). */
  sourceProofsResolver?: (amount: number) => Promise<import("@cashu/cashu-ts").Proof[]>;
}

export function createCashuEscrowProvider(
  config?: CashuEscrowProviderConfig,
): EscrowProvider {
  // Track token strings by escrow_ref for lookup
  const tokenMap = new Map<string, { token: string; escrowToken: EscrowToken }>();
  let refCounter = 0;

  return {
    async createHold(params) {
      // CashuEscrowProvider needs source proofs to create a hold.
      // In practice, the Requester calls createHtlcToken directly with proofs.
      // This adapter supports the case where proofs are provided via resolver.
      if (!config?.sourceProofsResolver) {
        return null;
      }

      const sourceProofs = await config.sourceProofsResolver(params.amount_sats);
      const result = await createHtlcToken(params.amount_sats, {
        hash: params.payment_hash,
        requesterPubkey: params.requester_pubkey,
        locktimeSeconds: params.expiry,
      }, sourceProofs);

      if (!result) return null;

      const ref = `cashu_htlc_${++refCounter}`;
      tokenMap.set(ref, { token: result.token, escrowToken: result });
      return { escrow_ref: ref };
    },

    async bindWorker(escrow_ref, worker_pubkey) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return null;

      // Decode to get requester pubkey from existing token
      const decoded = getDecodedToken(entry.token);
      const firstProof = decoded.proofs[0];
      let requesterPubkey = "";
      try {
        const secret = JSON.parse(firstProof?.secret ?? "[]");
        const tags: string[][] = secret[1]?.tags ?? [];
        const refundTag = tags.find((t: string[]) => t[0] === "refund");
        requesterPubkey = refundTag?.[1] ?? "";
      } catch { /* plain proof, no refund key */ }

      // Get locktime from escrow token
      let locktime = Math.floor(Date.now() / 1000) + 3600;
      try {
        const secret = JSON.parse(firstProof?.secret ?? "[]");
        const tags: string[][] = secret[1]?.tags ?? [];
        const locktimeTag = tags.find((t: string[]) => t[0] === "locktime");
        if (locktimeTag?.[1]) locktime = Number(locktimeTag[1]);
      } catch { /* use default */ }

      const hash = (() => {
        try {
          const secret = JSON.parse(firstProof?.secret ?? "[]");
          return secret[1]?.data ?? "";
        } catch { return ""; }
      })();

      const result = await swapHtlcBindWorker(entry.escrowToken.proofs, {
        hash,
        workerPubkey: worker_pubkey,
        requesterRefundPubkey: requesterPubkey,
        locktimeSeconds: locktime,
      });

      if (!result) return null;

      const newRef = `cashu_htlc_${++refCounter}`;
      tokenMap.set(newRef, { token: result.token, escrowToken: result });
      tokenMap.delete(escrow_ref);
      return { escrow_ref: newRef };
    },

    async verify(escrow_ref, expected_sats) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return { valid: false, error: "Unknown escrow reference" };

      const result = await verifyEscrowAmount(entry.token, expected_sats);
      return {
        valid: result.valid,
        amount_sats: result.amountSats,
        error: result.error,
      };
    },

    async verifyLock(escrow_ref, payment_hash, worker_pubkey) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return { ok: false, message: "Unknown escrow reference" };

      const result = verifyHtlcTokenLock(entry.token, payment_hash, worker_pubkey);
      return result;
    },

    async settle(_escrow_ref, _preimage) {
      // Settlement happens client-side (Worker calls redeemHtlcToken directly).
      // This is a no-op on the server/coordinator side.
      return { settled: true };
    },

    async cancel(escrow_ref) {
      const deleted = tokenMap.delete(escrow_ref);
      return { cancelled: deleted };
    },
  };
}
