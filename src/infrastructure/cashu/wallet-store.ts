/**
 * Proof-based wallet store for Worker and Requester roles.
 *
 * Tracks actual Cashu Proof[] — balance is derived from proof amounts.
 * Verifies proof states against the Cashu mint via checkProofsStates.
 */

import type { Proof } from "@cashu/cashu-ts";
import { getCashuConfig } from "./wallet";
import {
  type WalletRole,
  type WalletData,
  type WalletBalance,
  makeKey,
  selectProofs,
  computeBalance,
  pruneSpentProofs,
} from "./wallet-store-helpers";

export type { WalletRole, WalletBalance };

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

  return {
    addProofs(role, pubkey, proofs) {
      getData(role, pubkey).confirmed.push(...proofs);
    },

    lockForQuery(role, pubkey, queryId, amountSats) {
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
      return computeBalance(getData(role, pubkey), mintUrl);
    },

    getLockedProofs(role, pubkey, queryId) {
      return getData(role, pubkey).pending.get(queryId) ?? [];
    },

    withLock,

    async getVerifiedBalance(role, pubkey) {
      const data = getData(role, pubkey);
      await pruneSpentProofs(data, role, pubkey);
      return computeBalance(data, mintUrl);
    },
  };
}
