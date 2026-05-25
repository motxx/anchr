// NUT-11 P2PK 2-of-2 (Provider + group_pubkey). The FROST oracle group's
// BIP-340 signature serves as the second key — no Mint changes required.
// Refund after locktime uses the customer's single key.

import {
  getDecodedToken,
  P2PKBuilder,
  type P2PKOptions,
  type Proof,
} from "@cashu/cashu-ts";
import type { EscrowProvider } from "../requests/application/ports.ts";
import {
  computeNetAmount,
  encodeProofs,
  getWalletAndConfig,
  loadAndSend,
  sumProofAmounts,
} from "./cashu-escrow-helpers.ts";
import { verifyToken } from "./cashu-wallet.ts";

import { getLogger } from "../internal/runtime/logger.ts";
const log = getLogger(["anchr", "frost-escrow"]);

export interface FrostEscrowConfig {
  /** FROST group public key (BIP-340 x-only hex). */
  groupPubkey: string;
  /** Source proofs resolver. */
  sourceProofsResolver?: (amount: number) => Promise<Proof[]>;
}

export function buildFrostP2PKOptions(
  providerPubkey: string,
  groupPubkey: string,
  customerRefundPubkey: string,
  locktimeSeconds: number,
): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey([providerPubkey, groupPubkey])
    .requireLockSignatures(2)
    .lockUntil(locktimeSeconds)
    .addRefundPubkey(customerRefundPubkey)
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

      const sourceProofs = await config.sourceProofsResolver(
        params.amount_sats,
      );

      try {
        const send = await loadAndSend(
          ctx.wallet,
          params.amount_sats,
          sourceProofs,
        );
        const token = encodeProofs(ctx.config.mintUrl, send);
        const ref = `frost_p2pk_${++refCounter}`;
        tokenMap.set(ref, { token, proofs: send });
        return { escrow_ref: ref };
      } catch (error) {
        log.error(
          "Failed to create hold:",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },

    async bindProvider(escrow_ref, provider_pubkey) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return null;

      const ctx = await getWalletAndConfig();
      if (!ctx) return null;

      const locktimeSeconds = Math.floor(Date.now() / 1000) + 3600;

      const p2pkOptions = buildFrostP2PKOptions(
        provider_pubkey,
        config.groupPubkey,
        "",
        locktimeSeconds,
      );

      try {
        const amountSats = computeNetAmount(ctx.wallet, entry.proofs);
        if (amountSats === null) return null;

        const send = await loadAndSend(
          ctx.wallet,
          amountSats,
          entry.proofs,
          p2pkOptions,
        );
        const token = encodeProofs(ctx.config.mintUrl, send);
        const newRef = `frost_p2pk_${++refCounter}`;
        tokenMap.set(newRef, { token, proofs: send });
        tokenMap.delete(escrow_ref);
        return { escrow_ref: newRef };
      } catch (error) {
        log.error(
          "Failed to bind provider:",
          error instanceof Error ? error.message : error,
        );
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

    async verifyLock(escrow_ref, _payment_hash, provider_pubkey) {
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
          const hasProvider = pubkeys.slice(1).some((pk: string) =>
            pk === provider_pubkey || pk === `02${provider_pubkey}` ||
            pk === `03${provider_pubkey}`
          );
          const hasGroup = pubkeys.slice(1).some((pk: string) =>
            pk === config.groupPubkey || pk === `02${config.groupPubkey}` ||
            pk === `03${config.groupPubkey}`
          );
          if (!hasProvider) {
            return { ok: false, message: "Provider pubkey not in P2PK lock" };
          }
          if (!hasGroup) {
            return { ok: false, message: "Group pubkey not in P2PK lock" };
          }
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: `P2PK verification failed: ${
            error instanceof Error ? error.message : error
          }`,
        };
      }
    },

    settle(_escrow_ref, _preimage) {
      // FROST settlement requires threshold signing across the oracle
      // cluster (NOT a single private key the EscrowProvider could
      // hold). The provider drives redemption via the FROST coordinator
      // or release-authority path. Return a clear error rather
      // than a silent {settled:true} so any caller depending on this
      // port-level method sees the problem immediately.
      return Promise.resolve({
        settled: false,
        error:
          "settle() is not wired through EscrowProvider for FROST mode; provider must coordinate threshold signing directly",
      });
    },

    async cancel(escrow_ref) {
      const deleted = tokenMap.delete(escrow_ref);
      return { cancelled: deleted };
    },
  };
}
