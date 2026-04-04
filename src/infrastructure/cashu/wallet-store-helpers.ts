/**
 * Helper functions for wallet store operations.
 */

import type { Proof } from "@cashu/cashu-ts";
import { getCashuWallet } from "./wallet";

export type WalletRole = "requester" | "worker";

export interface WalletData {
  confirmed: Proof[];
  pending: Map<string, Proof[]>;
}

export interface WalletBalance {
  balance_sats: number;
  pending_sats: number;
  mint_url: string | null;
}

export function makeKey(role: string, pubkey: string): string {
  return `${role}:${pubkey}`;
}

export function sumProofs(proofs: Proof[]): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

export function selectProofs(
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

export function computeBalance(data: WalletData, mintUrl: string | null): WalletBalance {
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

export async function pruneSpentProofs(
  data: WalletData,
  role: WalletRole,
  pubkey: string,
): Promise<void> {
  const wallet = getCashuWallet();
  if (!wallet || data.confirmed.length === 0) return;

  try {
    await wallet.loadMint();
    const states = await wallet.checkProofsStates(data.confirmed);
    const unspent = data.confirmed.filter(
      (_, i) => states[i]?.state === "UNSPENT",
    );
    if (unspent.length < data.confirmed.length) {
      const removed = data.confirmed.length - unspent.length;
      console.error(`[wallet] Pruned ${removed} spent proof(s) from ${role}:${pubkey}`);
      data.confirmed = unspent;
    }
  } catch (err) {
    console.error(
      `[wallet] Mint verification failed for ${role}:${pubkey}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
