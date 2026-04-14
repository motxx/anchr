/**
 * Market wallet operations — user proof management for prediction markets.
 *
 * Extracted from market-api-routes.ts to enable dependency injection and testing.
 * All functions take a `userProofs` map as parameter instead of accessing globals.
 */

import { Wallet, type Proof } from "@cashu/cashu-ts";
import { spawn } from "../../../src/runtime/mod.ts";

// ---------------------------------------------------------------------------
// Core wallet operations (pure functions on userProofs map)
// ---------------------------------------------------------------------------

/** Get user balance from stored proofs. */
export function getUserBalance(
  userProofs: Map<string, Proof[]>,
  pubkey: string,
): number {
  const proofs = userProofs.get(pubkey) ?? [];
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

/** Append proofs to a user's balance. */
export function creditUser(
  userProofs: Map<string, Proof[]>,
  pubkey: string,
  proofs: Proof[],
): void {
  const existing = userProofs.get(pubkey) ?? [];
  userProofs.set(pubkey, [...existing, ...proofs]);
}

/**
 * Deduct proofs from a user's balance. Uses wallet.send() to split
 * proofs to exact amount when an exact match is not available.
 * Returns the exact-amount proofs on success, or null on failure.
 */
export async function debitUser(
  userProofs: Map<string, Proof[]>,
  pubkey: string,
  amountSats: number,
  wallet: Wallet,
): Promise<Proof[] | null> {
  const proofs = userProofs.get(pubkey) ?? [];
  const balance = proofs.reduce((sum, p) => sum + p.amount, 0);
  if (balance < amountSats) return null;

  // Try exact combination first (greedy largest-first)
  const sorted = [...proofs].sort((a, b) => b.amount - a.amount);
  const selected: Proof[] = [];
  let selectedTotal = 0;
  for (const p of sorted) {
    if (selectedTotal >= amountSats) break;
    selected.push(p);
    selectedTotal += p.amount;
  }

  if (selectedTotal < amountSats) return null;

  if (selectedTotal === amountSats) {
    // Exact match — remove selected from user's store
    const remaining = proofs.filter(
      (p) => !selected.some((s) => s.C === p.C),
    );
    userProofs.set(pubkey, remaining);
    return selected;
  }

  // Need to split via mint — send exact amount, keep change
  try {
    await wallet.loadMint();
    const { send, keep } = await wallet.ops.send(amountSats, selected).run();
    // Remove the selected proofs and add back the change
    const remaining = proofs.filter(
      (p) => !selected.some((s) => s.C === p.C),
    );
    userProofs.set(pubkey, [...remaining, ...keep]);
    return send;
  } catch (err) {
    console.error(
      "[market-wallet] Failed to split proofs:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory — dependency-injected wallet for testing
// ---------------------------------------------------------------------------

export interface MarketWallet {
  getBalance(pubkey: string): number;
  credit(pubkey: string, proofs: Proof[]): void;
  debit(
    pubkey: string,
    amount: number,
    wallet: Wallet,
  ): Promise<Proof[] | null>;
}

/**
 * Create a MarketWallet backed by the given proof store.
 * When no store is provided, a fresh empty Map is created.
 */
export function createMarketWallet(
  proofStore?: Map<string, Proof[]>,
): MarketWallet {
  const store = proofStore ?? new Map<string, Proof[]>();
  return {
    getBalance(pubkey: string): number {
      return getUserBalance(store, pubkey);
    },
    credit(pubkey: string, proofs: Proof[]): void {
      creditUser(store, pubkey, proofs);
    },
    debit(
      pubkey: string,
      amount: number,
      wallet: Wallet,
    ): Promise<Proof[] | null> {
      return debitUser(store, pubkey, amount, wallet);
    },
  };
}

// ---------------------------------------------------------------------------
// Infrastructure helpers (Cashu wallet + Lightning)
// ---------------------------------------------------------------------------

/** Check if the Cashu mint is reachable at the given URL. */
export async function isMintReachable(mintUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${mintUrl}/v1/info`, {
      signal: AbortSignal.timeout(3000),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/** Pay a Lightning invoice via lnd-user docker container. */
export async function payInvoiceViaLndUser(bolt11: string): Promise<boolean> {
  try {
    const proc = spawn(
      [
        "docker", "compose", "exec", "-T", "lnd-user",
        "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
        "payinvoice", "--force", bolt11,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Mint fresh Cashu proofs via regtest Lightning.
 * Creates a mint quote, pays the Lightning invoice via lnd-user, then
 * claims the proofs from the mint.
 */
export async function mintProofsFromRegtest(
  wallet: Wallet,
  amountSats: number,
): Promise<Proof[]> {
  const mintQuote = await wallet.createMintQuote(amountSats);
  const paid = await payInvoiceViaLndUser(mintQuote.request);
  if (!paid) throw new Error("Failed to pay Lightning invoice via lnd-user");
  // Brief pause for mint to register the payment
  await new Promise((r) => setTimeout(r, 2000));
  return wallet.mintProofs(amountSats, mintQuote.quote);
}
