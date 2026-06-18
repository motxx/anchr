// NUT-11 P2PK 2-of-2 (Provider + group_pubkey). The FROST oracle group's
// BIP-340 signature serves as the second key — no Mint changes required.
// Refund after locktime uses the customer's single key.

import {
  getDecodedToken,
  P2PKBuilder,
  type P2PKOptions,
  type Proof,
  signP2PKProofs,
} from "@cashu/cashu-ts";
import type { EscrowProvider } from "../../requests/application/ports.ts";
import {
  computeNetAmount,
  encodeProofs,
  getWalletAndConfig,
  loadAndSend,
  sumProofAmounts,
} from "./cashu-escrow-helpers.ts";
import { verifyToken } from "./cashu-wallet.ts";
import { redeemSignedProofs } from "./redeem-swap.ts";

import { getLogger } from "../../internal/runtime/logger.ts";
const log = getLogger(["anchr", "frost-escrow"]);

export interface FrostEscrowConfig {
  /** FROST group public key (BIP-340 x-only hex). */
  groupPubkey: string;
  /** Source proofs resolver. */
  sourceProofsResolver?: (amount: number) => Promise<Proof[]>;
}

export interface FrostP2pkRedeemResult {
  token: string;
  proofs: Proof[];
  amountSats: number;
}

export function buildFrostP2PKOptions(
  providerPubkey: string,
  groupPubkey: string,
  customerRefundPubkey: string,
  locktimeSeconds: number,
): P2PKOptions {
  if (!customerRefundPubkey) {
    // Without a refund key, funds are stranded forever if the FROST group
    // never releases — refuse to build such a lock.
    throw new Error(
      "FROST P2PK Payment Lock requires a customer refund pubkey",
    );
  }
  return new P2PKBuilder()
    .addLockPubkey([providerPubkey, groupPubkey])
    .requireLockSignatures(2)
    .lockUntil(locktimeSeconds)
    .addRefundPubkey(customerRefundPubkey)
    .requireRefundSignatures(1)
    .toOptions();
}

export function createFrostEscrowProvider(
  config: FrostEscrowConfig,
): EscrowProvider {
  const tokenMap = new Map<string, {
    token: string;
    proofs: Proof[];
    customerRefundPubkey: string;
    locktimeSeconds: number;
  }>();
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
        tokenMap.set(ref, {
          token,
          proofs: send,
          customerRefundPubkey: params.customer_pubkey,
          locktimeSeconds: params.expiry,
        });
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

      if (!entry.customerRefundPubkey) {
        log.error("Refusing to bind FROST escrow without a refund pubkey");
        return null;
      }

      const p2pkOptions = buildFrostP2PKOptions(
        provider_pubkey,
        config.groupPubkey,
        entry.customerRefundPubkey,
        entry.locktimeSeconds,
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
        tokenMap.set(newRef, {
          token,
          proofs: send,
          customerRefundPubkey: entry.customerRefundPubkey,
          locktimeSeconds: entry.locktimeSeconds,
        });
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
          const body = secret[1];
          if (!isRecord(body)) {
            return { ok: false, message: "Malformed P2PK proof" };
          }
          const tags = readStringTags(body.tags);
          const lockPubkeys: string[] = [];
          if (typeof body.data === "string") lockPubkeys.push(body.data);
          const pubkeys = tags.find((tag) => tag[0] === "pubkeys");
          if (pubkeys) lockPubkeys.push(...pubkeys.slice(1));
          if (lockPubkeys.length === 0) {
            return { ok: false, message: "No lock pubkeys in P2PK proof" };
          }
          const nSigs = tags.find((tag) => tag[0] === "n_sigs");
          if (nSigs?.[1] !== "2") {
            return {
              ok: false,
              message: "FROST P2PK lock must require 2 signatures",
            };
          }
          const hasProvider = lockPubkeys.some((pk) =>
            sameXOnlyPubkey(pk, provider_pubkey)
          );
          const hasGroup = lockPubkeys.some((pk) =>
            sameXOnlyPubkey(pk, config.groupPubkey)
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

export async function redeemFrostP2PKToken(
  encodedToken: string,
  providerPrivateKey: string,
  groupSignatures: string[],
): Promise<FrostP2pkRedeemResult | null> {
  const ctx = await getWalletAndConfig();
  if (!ctx) return null;

  const decoded = getDecodedToken(encodedToken);
  const providerSigned = signP2PKProofs(decoded.proofs, providerPrivateKey);
  const signedProofs = appendFrostP2PKGroupSignatures(
    providerSigned,
    groupSignatures,
  );
  const redeem = await redeemSignedProofs({
    wallet: ctx.wallet,
    signedProofs,
    signingPrivateKey: providerPrivateKey,
  });
  if (!redeem.ok) {
    if (redeem.uncertain) {
      throw new Error(
        "redeemFrostP2PKToken: mint swap failed with inputs spent or unknowable — check the mint before retrying",
        { cause: redeem.cause },
      );
    }
    log.error(
      "Failed to redeem FROST P2PK token:",
      redeem.cause instanceof Error ? redeem.cause.message : redeem.reason,
    );
    return null;
  }
  return {
    token: encodeProofs(ctx.config.mintUrl, redeem.proofs),
    proofs: redeem.proofs,
    amountSats: redeem.amountSats,
  };
}

export function appendFrostP2PKGroupSignatures(
  proofs: Proof[],
  groupSignatures: string[],
): Proof[] {
  if (proofs.length !== groupSignatures.length) {
    throw new Error("FROST signature count must match proof count");
  }
  return proofs.map((proof, index) => {
    const witness = parseWitness(proof.witness);
    const signatures = getWitnessSignatures(witness);
    const groupSignature = groupSignatures[index];
    if (groupSignature === undefined) {
      throw new Error("Missing FROST group signature for proof");
    }
    return {
      ...proof,
      witness: JSON.stringify({
        ...witness,
        signatures: [...signatures, groupSignature],
      }),
    };
  });
}

function parseWitness(witness: unknown): Record<string, unknown> {
  if (typeof witness === "string") {
    try {
      const parsed = JSON.parse(witness);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(witness) ? witness : {};
}

function getWitnessSignatures(witness: Record<string, unknown>): string[] {
  const signatures = witness.signatures;
  if (!Array.isArray(signatures)) return [];
  return signatures.filter((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringTags(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string[] =>
    Array.isArray(entry) &&
    entry.every((item) => typeof item === "string")
  );
}

function sameXOnlyPubkey(candidate: string, expected: string): boolean {
  return toXOnly(candidate).toLowerCase() === toXOnly(expected).toLowerCase();
}

function toXOnly(pubkey: string): string {
  if (
    pubkey.length === 66 &&
    (pubkey.startsWith("02") || pubkey.startsWith("03"))
  ) {
    return pubkey.slice(2);
  }
  return pubkey;
}
