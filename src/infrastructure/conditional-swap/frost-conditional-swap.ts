/**
 * FROST P2PK Conditional Swap — replaces HTLC preimage for threshold Oracle.
 *
 * Tokens are locked with P2PK([group_pubkey, counterparty_pubkey], n_sigs=2).
 * The Oracle signs with the winning outcome's group key; winner redeems with
 * oracle_sig + own_sig. Without t-of-n Oracle agreement, neither signature can
 * be produced and tokens refund after locktime.
 *
 * In production: group_pubkey_a/b are FROST DKG-generated threshold keys.
 * In demo mode: single Schnorr keypairs with the same P2PK interface.
 */

import {
  P2PKBuilder,
  type Proof,
  type P2PKOptions,
  getEncodedToken,
} from "@cashu/cashu-ts";
import type { EscrowToken } from "../cashu/escrow.ts";
import type { FrostConditionalSwapDef } from "../../domain/conditional-swap-types.ts";
import {
  getWalletAndConfig,
  encodeProofs,
  loadAndSend,
} from "../cashu/escrow-helpers.ts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";

// ---------------------------------------------------------------------------
// P2PK option builders
// ---------------------------------------------------------------------------

/**
 * Build P2PK options for party A's token (redeemable by B if outcome B wins).
 *
 * Lock: P2PK([group_pubkey_b, counterpartyPubkey], n_sigs=2)
 * - group_pubkey_b: Oracle's group key for outcome B
 * - counterpartyPubkey: Party B's personal key
 * - refundPubkey: Party A (refund after locktime)
 */
export function buildFrostSwapForPartyA(params: {
  group_pubkey_b: string;
  counterpartyPubkey: string;
  refundPubkey: string;
  locktime: number;
}): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey([params.group_pubkey_b, params.counterpartyPubkey])
    .requireLockSignatures(2)
    .lockUntil(params.locktime)
    .addRefundPubkey(params.refundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Build P2PK options for party B's token (redeemable by A if outcome A wins).
 *
 * Lock: P2PK([group_pubkey_a, counterpartyPubkey], n_sigs=2)
 * - group_pubkey_a: Oracle's group key for outcome A
 * - counterpartyPubkey: Party A's personal key
 * - refundPubkey: Party B (refund after locktime)
 */
export function buildFrostSwapForPartyB(params: {
  group_pubkey_a: string;
  counterpartyPubkey: string;
  refundPubkey: string;
  locktime: number;
}): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey([params.group_pubkey_a, params.counterpartyPubkey])
    .requireLockSignatures(2)
    .lockUntil(params.locktime)
    .addRefundPubkey(params.refundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

// ---------------------------------------------------------------------------
// Dual Key Store — manages two keypairs per swap
// ---------------------------------------------------------------------------

/** A stored keypair entry for a conditional swap. */
export interface DualKeyEntry {
  swap_id: string;
  /** Group pubkey for outcome A (hex, x-only BIP-340). */
  pubkey_a: string;
  /** Group pubkey for outcome B (hex, x-only BIP-340). */
  pubkey_b: string;
  /** Secret key for outcome A — only present in demo mode (single server). */
  secret_a?: string;
  /** Secret key for outcome B — only present in demo mode. */
  secret_b?: string;
  /** Whether a signing has been performed (one-time). */
  signed: boolean;
}

/**
 * Store for dual keypairs used in FROST P2PK conditional swaps.
 *
 * In demo mode: generates single Schnorr keypairs.
 * In production: stores FROST group pubkeys (secrets held by threshold signers).
 */
export interface DualKeyStore {
  /** Create a new keypair pair for a swap. Returns both public keys. */
  create(swap_id: string): DualKeyEntry;
  /** Sign a message with the winning outcome's key. Returns hex signature or null. */
  sign(swap_id: string, outcome: "a" | "b", message: Uint8Array): string | null;
  /**
   * Sign multiple proof secrets for NUT-11 P2PK redemption.
   *
   * For each proof secret string, computes SHA256(secret) and signs with the
   * winning outcome's key. This is what NUT-11 expects: the signing message
   * is the hash of the proof's secret field.
   *
   * Unlike `sign()`, this does NOT mark the swap as "signed" (one-time),
   * because proof secrets are only available at resolution time when matched
   * pairs' tokens are decoded.
   *
   * @returns Map of proofSecret -> hex signature, or null on failure
   */
  signProofSecrets(
    swap_id: string,
    outcome: "a" | "b",
    proofSecrets: string[],
  ): Map<string, string> | null;
  /** Get public keys for a swap. */
  getPubkeys(swap_id: string): { pubkey_a: string; pubkey_b: string } | null;
  /** Check whether a swap exists. */
  has(swap_id: string): boolean;
}

/**
 * Create a demo-mode DualKeyStore using single Schnorr keypairs.
 *
 * Uses nostr-tools `generateSecretKey` / `getPublicKey` for key generation
 * and `@noble/curves/secp256k1` `schnorr.sign` for signing.
 *
 * Compatible interface with production FROST — swap to FROST DKG keys
 * without changing the consumer code.
 */
export function createDualKeyStore(): DualKeyStore {
  const entries = new Map<string, DualKeyEntry>();

  return {
    create(swap_id: string): DualKeyEntry {
      const existing = entries.get(swap_id);
      if (existing) return existing;

      const sk_a = generateSecretKey();
      const sk_b = generateSecretKey();
      const pk_a = getPublicKey(sk_a);
      const pk_b = getPublicKey(sk_b);

      const entry: DualKeyEntry = {
        swap_id,
        pubkey_a: pk_a,
        pubkey_b: pk_b,
        secret_a: bytesToHex(sk_a),
        secret_b: bytesToHex(sk_b),
        signed: false,
      };

      entries.set(swap_id, entry);
      return entry;
    },

    sign(swap_id: string, outcome: "a" | "b", message: Uint8Array): string | null {
      const entry = entries.get(swap_id);
      if (!entry || entry.signed) return null;

      const secret = outcome === "a" ? entry.secret_a : entry.secret_b;
      if (!secret) return null;

      // Mark as signed — one-time operation, same as preimage reveal
      entry.signed = true;

      // Delete the losing side's secret key — irreversible
      if (outcome === "a") {
        delete entry.secret_b;
      } else {
        delete entry.secret_a;
      }

      const sig = schnorr.sign(message, hexToBytes(secret));
      return bytesToHex(sig);
    },

    signProofSecrets(
      swap_id: string,
      outcome: "a" | "b",
      proofSecrets: string[],
    ): Map<string, string> | null {
      const entry = entries.get(swap_id);
      if (!entry) return null;

      const secret = outcome === "a" ? entry.secret_a : entry.secret_b;
      if (!secret) return null;

      const sk = hexToBytes(secret);
      const result = new Map<string, string>();

      for (const proofSecret of proofSecrets) {
        // NUT-11 P2PK: signing message = SHA256(proof.secret)
        const msgHash = sha256(new TextEncoder().encode(proofSecret));
        const sig = schnorr.sign(msgHash, sk);
        result.set(proofSecret, bytesToHex(sig));
      }

      // Mark as signed and delete the losing key — irreversible
      entry.signed = true;
      if (outcome === "a") {
        delete entry.secret_b;
      } else {
        delete entry.secret_a;
      }

      return result;
    },

    getPubkeys(swap_id: string): { pubkey_a: string; pubkey_b: string } | null {
      const entry = entries.get(swap_id);
      if (!entry) return null;
      return { pubkey_a: entry.pubkey_a, pubkey_b: entry.pubkey_b };
    },

    has(swap_id: string): boolean {
      return entries.has(swap_id);
    },
  };
}

// ---------------------------------------------------------------------------
// Swap pair token creation
// ---------------------------------------------------------------------------

/**
 * Create both FROST P2PK escrow tokens for a matched pair.
 *
 * - token_a_to_b: Party A's proofs locked with P2PK([group_pubkey_b, B], 2)
 *   — B redeems if outcome B wins (Oracle signs with group_key_b).
 * - token_b_to_a: Party B's proofs locked with P2PK([group_pubkey_a, A], 2)
 *   — A redeems if outcome A wins (Oracle signs with group_key_a).
 */
export async function createFrostSwapPairTokens(
  partyAProofs: Proof[],
  partyBProofs: Proof[],
  amount: number,
  swap: FrostConditionalSwapDef,
  partyAPubkey: string,
  partyBPubkey: string,
): Promise<{ tokenAtoB: EscrowToken; tokenBtoA: EscrowToken } | null> {
  const ctx = await getWalletAndConfig();
  if (!ctx) return null;

  const optionsAtoB = buildFrostSwapForPartyA({
    group_pubkey_b: swap.group_pubkey_b,
    counterpartyPubkey: partyBPubkey,
    refundPubkey: partyAPubkey,
    locktime: swap.locktime,
  });

  const optionsBtoA = buildFrostSwapForPartyB({
    group_pubkey_a: swap.group_pubkey_a,
    counterpartyPubkey: partyAPubkey,
    refundPubkey: partyBPubkey,
    locktime: swap.locktime,
  });

  try {
    const sendA = await loadAndSend(ctx.wallet, amount, partyAProofs, optionsAtoB);
    const sendB = await loadAndSend(ctx.wallet, amount, partyBProofs, optionsBtoA);

    const tokenAtoB: EscrowToken = {
      token: encodeProofs(ctx.config.mintUrl, sendA),
      proofs: sendA,
      p2pkOptions: optionsAtoB,
      amountSats: amount,
    };

    const tokenBtoA: EscrowToken = {
      token: encodeProofs(ctx.config.mintUrl, sendB),
      proofs: sendB,
      p2pkOptions: optionsBtoA,
      amountSats: amount,
    };

    return { tokenAtoB, tokenBtoA };
  } catch (error) {
    console.error(
      "[frost-swap] Failed to create swap pair tokens:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
