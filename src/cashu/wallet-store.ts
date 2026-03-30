/**
 * Proof-based wallet store for Worker and Requester roles.
 *
 * Tracks actual Cashu Proof[] — balance is derived from proof amounts.
 * Verifies proof states against the Cashu mint via checkProofsStates.
 */

import type { Proof } from "@cashu/cashu-ts";
import { getCashuWallet, getCashuConfig } from "./wallet";

export type WalletRole = "requester" | "worker";

export interface WalletBalance {
  balance_sats: number;
  pending_sats: number;
  mint_url: string | null;
}

interface WalletData {
  confirmed: Proof[];
  /** Proofs locked per query ID (escrow). */
  pending: Map<string, Proof[]>;
}

function makeKey(role: string, pubkey: string): string {
  return `${role}:${pubkey}`;
}

function sumProofs(proofs: Proof[]): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Select proofs that sum to at least targetSats (greedy, largest-first).
 * Returns null if confirmed proofs are insufficient.
 */
function selectProofs(
  proofs: Proof[],
  targetSats: number,
): { selected: Proof[]; remaining: Proof[] } | null {
  const sorted = [...proofs].sort((a, b) => b.amount - a.amount);
  const selected: Proof[] = [];
  let total = 0;
  for (const p of sorted) {
    selected.push(p);
    total += p.amount;
    if (total >= targetSats) {
      const selectedSecrets = new Set(selected.map((s) => s.secret));
      const remaining = proofs.filter((p) => !selectedSecrets.has(p.secret));
      return { selected, remaining };
    }
  }
  return null;
}

export interface WalletStore {
  /** Add proofs to the wallet's confirmed balance. */
  addProofs(role: WalletRole, pubkey: string, proofs: Proof[]): void;

  /** Select proofs from confirmed and lock them for a query. Returns locked proofs, or null if insufficient. */
  lockForQuery(role: WalletRole, pubkey: string, queryId: string, amountSats: number): Proof[] | null;

  /** Transfer locked proofs from one wallet to another's confirmed balance (on approval). */
  transferLocked(
    fromRole: WalletRole, fromPubkey: string, queryId: string,
    toRole: WalletRole, toPubkey: string,
  ): void;

  /** Return locked proofs to the owner's confirmed balance (on rejection/cancel). */
  unlockForQuery(role: WalletRole, pubkey: string, queryId: string): void;

  /** Get balance derived from local proof state (fast, no network). */
  getBalance(role: WalletRole, pubkey: string): WalletBalance;

  /** Get balance verified against the Cashu mint (removes spent proofs). */
  getVerifiedBalance(role: WalletRole, pubkey: string): Promise<WalletBalance>;

  /** Get proofs locked for a specific query (for HTLC verification). */
  getLockedProofs(role: WalletRole, pubkey: string, queryId: string): Proof[];

  /** Serialize concurrent mutations on a per-wallet basis. */
  withLock<T>(role: WalletRole, pubkey: string, fn: () => T | Promise<T>): Promise<T>;
}

export function createWalletStore(): WalletStore {
  const wallets = new Map<string, WalletData>();
  const mintUrl = getCashuConfig()?.mintUrl ?? null;
  /** Per-wallet mutex: prevents concurrent lock/transfer/unlock races. */
  const locks = new Map<string, Promise<void>>();

  function getData(role: WalletRole, pubkey: string): WalletData {
    const key = makeKey(role, pubkey);
    let data = wallets.get(key);
    if (!data) {
      data = { confirmed: [], pending: new Map() };
      wallets.set(key, data);
    }
    return data;
  }

  /** Acquire a per-wallet mutex to serialize state mutations. */
  async function withLock<T>(role: WalletRole, pubkey: string, fn: () => T | Promise<T>): Promise<T> {
    const key = makeKey(role, pubkey);
    const prev = locks.get(key) ?? Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    locks.set(key, next);
    try {
      await prev;
      return await fn();
    } finally {
      resolve!();
    }
  }

  function computeBalance(data: WalletData): WalletBalance {
    const pendingSats = [...data.pending.values()].reduce(
      (sum, proofs) => sum + sumProofs(proofs),
      0,
    );
    return {
      balance_sats: sumProofs(data.confirmed),
      pending_sats: pendingSats,
      mint_url: mintUrl,
    };
  }

  return {
    addProofs(role, pubkey, proofs) {
      getData(role, pubkey).confirmed.push(...proofs);
    },

    lockForQuery(role, pubkey, queryId, amountSats) {
      // Synchronous path — callers that need atomicity should use the async
      // withLock wrapper at the service layer. This remains sync for compat.
      const data = getData(role, pubkey);
      const result = selectProofs(data.confirmed, amountSats);
      if (!result) return null;
      data.confirmed = result.remaining;
      data.pending.set(queryId, result.selected);
      return result.selected;
    },

    transferLocked(fromRole, fromPubkey, queryId, toRole, toPubkey) {
      const fromData = getData(fromRole, fromPubkey);
      const proofs = fromData.pending.get(queryId);
      if (!proofs) return;
      fromData.pending.delete(queryId);
      getData(toRole, toPubkey).confirmed.push(...proofs);
    },

    unlockForQuery(role, pubkey, queryId) {
      const data = getData(role, pubkey);
      const proofs = data.pending.get(queryId);
      if (!proofs) return;
      data.pending.delete(queryId);
      data.confirmed.push(...proofs);
    },

    getBalance(role, pubkey) {
      return computeBalance(getData(role, pubkey));
    },

    getLockedProofs(role, pubkey, queryId) {
      return getData(role, pubkey).pending.get(queryId) ?? [];
    },

    withLock,

    async getVerifiedBalance(role, pubkey) {
      const data = getData(role, pubkey);
      const wallet = getCashuWallet();

      if (wallet && data.confirmed.length > 0) {
        try {
          await wallet.loadMint();
          const states = await wallet.checkProofsStates(data.confirmed);
          const unspent = data.confirmed.filter(
            (_, i) => states[i]?.state === "UNSPENT",
          );
          if (unspent.length < data.confirmed.length) {
            const removed = data.confirmed.length - unspent.length;
            console.error(
              `[wallet] Pruned ${removed} spent proof(s) from ${role}:${pubkey}`,
            );
            data.confirmed = unspent;
          }
        } catch (err) {
          console.error(
            `[wallet] Mint verification failed for ${role}:${pubkey}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      return computeBalance(data);
    },
  };
}
