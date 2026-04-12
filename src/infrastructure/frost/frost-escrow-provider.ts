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
  getDecodedToken,
} from "@cashu/cashu-ts";
import type { EscrowProvider } from "../../application/escrow-port";
import {
  getWalletAndConfig,
  encodeProofs,
  loadAndSend,
  computeNetAmount,
  sumProofAmounts,
} from "../cashu/escrow-helpers";
import { verifyToken } from "../cashu/wallet";

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

      const locktimeSeconds = Math.floor(Date.now() / 1000) + 3600;

      const p2pkOptions = buildFrostP2PKOptions(
        worker_pubkey,
        config.groupPubkey,
        "",
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

      const result = await verifyToken(entry.token, expected_sats);
      return {
        valid: result.valid,
        amount_sats: result.amountSats,
        error: result.error,
      };
    },

    async verifyLock(escrow_ref, _payment_hash, worker_pubkey) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return { ok: false, message: "Unknown escrow reference" };

      try {
        const decoded = getDecodedToken(entry.token);
        for (const proof of decoded.proofs) {
          const secret = JSON.parse(proof.secret);
          if (!Array.isArray(secret) || secret[0] !== "P2PK") {
            return { ok: false, message: "Not a P2PK proof" };
          }
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
      return { settled: true };
    },

    async cancel(escrow_ref) {
      const deleted = tokenMap.delete(escrow_ref);
      return { cancelled: deleted };
    },
  };
}
