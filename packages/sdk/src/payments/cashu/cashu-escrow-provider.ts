import type { EscrowProvider } from "../../requests/application/ports.ts";
import {
  createHtlcToken,
  type EscrowToken,
  swapHtlcBindProvider,
} from "./cashu-escrow.ts";
import { verifyToken } from "./cashu-wallet.ts";
import { getDecodedToken, type Proof } from "@cashu/cashu-ts";

export interface CashuEscrowProviderConfig {
  /** Source Cashu proofs for createHold (if known ahead of time). */
  sourceProofsResolver?: (amount: number) => Promise<Proof[]>;
}

export function createCashuEscrowProvider(
  config?: CashuEscrowProviderConfig,
): EscrowProvider {
  const tokenMap = new Map<
    string,
    { token: string; escrowToken: EscrowToken }
  >();
  let refCounter = 0;

  return {
    async createHold(params) {
      if (!config?.sourceProofsResolver) {
        return null;
      }

      const sourceProofs = await config.sourceProofsResolver(
        params.amount_sats,
      );
      const result = await createHtlcToken(params.amount_sats, {
        hash: params.payment_hash,
        customerPubkey: params.customer_pubkey,
        locktimeSeconds: params.expiry,
      }, sourceProofs);

      if (!result) return null;

      const ref = `cashu_htlc_${++refCounter}`;
      tokenMap.set(ref, { token: result.token, escrowToken: result });
      return { escrow_ref: ref };
    },

    async bindProvider(escrow_ref, provider_pubkey) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return null;

      const decoded = getDecodedToken(entry.token);
      const firstProof = decoded.proofs[0];
      let customerPubkey = "";
      try {
        const secret = JSON.parse(firstProof?.secret ?? "[]");
        const tags: string[][] = secret[1]?.tags ?? [];
        const refundTag = tags.find((t: string[]) => t[0] === "refund");
        customerPubkey = refundTag?.[1] ?? "";
      } catch { /* plain proof, no refund key */ }

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
        } catch {
          return "";
        }
      })();

      const result = await swapHtlcBindProvider(entry.escrowToken.proofs, {
        hash,
        providerPubkey: provider_pubkey,
        customerRefundPubkey: customerPubkey,
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

      const result = await verifyToken(entry.token, expected_sats);
      return {
        valid: result.valid,
        amount_sats: result.amountSats,
        error: result.error,
      };
    },

    async verifyLock(escrow_ref, payment_hash, provider_pubkey) {
      const entry = tokenMap.get(escrow_ref);
      if (!entry) return { ok: false, message: "Unknown escrow reference" };

      let decoded;
      try {
        decoded = getDecodedToken(entry.token);
      } catch (err) {
        // Fail closed: an undecodable token gives us no basis to claim
        // it's locked correctly. Returning ok:true here would let any
        // malformed string bypass HTLC + P2PK verification.
        return {
          ok: false,
          message: `Token failed to decode: ${
            err instanceof Error ? err.message : "unknown"
          }`,
        };
      }

      let checkedHtlcProof = false;
      for (const proof of decoded.proofs) {
        let secret: unknown;
        try {
          secret = JSON.parse(proof.secret);
        } catch {
          return { ok: false, message: "Proof secret is not valid JSON" };
        }
        if (!Array.isArray(secret) || secret[0] !== "HTLC") {
          return { ok: false, message: "Proof is not an HTLC proof" };
        }
        checkedHtlcProof = true;

        if (secret[1]?.data !== payment_hash) {
          return {
            ok: false,
            message: "HTLC hash mismatch: token hashlock does not match query",
          };
        }

        const tags: string[][] | undefined = secret[1]?.tags;
        const pubkeyTag = tags?.find((t: string[]) => t[0] === "pubkeys");
        if (!pubkeyTag) {
          return { ok: false, message: "No pubkeys tag in HTLC proof" };
        }
        const lockedKeys = pubkeyTag.slice(1);
        const providerHex =
          provider_pubkey.startsWith("02") || provider_pubkey.startsWith("03")
            ? provider_pubkey
            : `02${provider_pubkey}`;
        if (
          !lockedKeys.includes(provider_pubkey) &&
          !lockedKeys.includes(providerHex)
        ) {
          return {
            ok: false,
            message: "HTLC token not locked to selected provider",
          };
        }
      }
      if (!checkedHtlcProof) {
        return { ok: false, message: "Token has no HTLC proofs" };
      }
      return { ok: true };
    },

    settle(_escrow_ref, _preimage) {
      // Settlement at the mint requires the provider's private key, which
      // EscrowProvider does not carry. The provider calls
      // `redeemHtlcToken(...)` from `@anchr/sdk/payments` directly.
      // Return a clear error rather than a silent {settled:true} so that
      // any caller depending on this port-level method sees the problem
      // immediately.
      return Promise.resolve({
        settled: false,
        error:
          "settle() is not wired through EscrowProvider; provider must call redeemHtlcToken() directly with its private key",
      });
    },

    async cancel(escrow_ref) {
      const deleted = tokenMap.delete(escrow_ref);
      return { cancelled: deleted };
    },
  };
}
