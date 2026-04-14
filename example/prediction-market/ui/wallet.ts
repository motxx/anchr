/**
 * Browser-side Cashu wallet for non-custodial prediction market.
 *
 * Proofs are stored in localStorage. The browser holds its own balance
 * and creates P2PK-locked tokens directly — the server never touches them.
 *
 * The wallet uses the same @cashu/cashu-ts Wallet class as the server,
 * since it works in the browser.
 */

import { Wallet, type Proof, getDecodedToken, getEncodedToken } from "@cashu/cashu-ts";

const PROOF_STORAGE_KEY = "anchr_market_proofs";

// ---------------------------------------------------------------------------
// Wallet initialization
// ---------------------------------------------------------------------------

let _wallet: Wallet | null = null;
let _mintUrl: string | null = null;

/**
 * Initialize the browser-side Cashu wallet.
 *
 * In the browser, the mint URL comes from the server (via /markets config or env).
 * For the demo, we use a default that can be overridden.
 */
export async function initWallet(mintUrl: string): Promise<Wallet> {
  if (_wallet && _mintUrl === mintUrl) return _wallet;
  _wallet = new Wallet(mintUrl, { unit: "sat" });
  _mintUrl = mintUrl;
  await _wallet.loadMint();
  return _wallet;
}

/**
 * Get the current wallet instance, or null if not initialized.
 */
export function getWallet(): Wallet | null {
  return _wallet;
}

/**
 * Get the current mint URL.
 */
export function getMintUrl(): string | null {
  return _mintUrl;
}

// ---------------------------------------------------------------------------
// Proof storage (localStorage)
// ---------------------------------------------------------------------------

/**
 * Load proofs from localStorage.
 */
export function loadProofs(): Proof[] {
  try {
    const raw = localStorage.getItem(PROOF_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Proof[];
  } catch {
    return [];
  }
}

/**
 * Save proofs to localStorage.
 */
export function saveProofs(proofs: Proof[]): void {
  localStorage.setItem(PROOF_STORAGE_KEY, JSON.stringify(proofs));
}

/**
 * Get current balance from stored proofs.
 */
export function getBalance(): number {
  return loadProofs().reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Add proofs to the stored balance.
 */
export function addProofs(newProofs: Proof[]): void {
  const existing = loadProofs();
  saveProofs([...existing, ...newProofs]);
}

/**
 * Remove specific proofs from storage (after spending).
 */
export function removeProofs(spentProofs: Proof[]): void {
  const existing = loadProofs();
  const spentCs = new Set(spentProofs.map((p) => p.C));
  saveProofs(existing.filter((p) => !spentCs.has(p.C)));
}

// ---------------------------------------------------------------------------
// Token operations
// ---------------------------------------------------------------------------

/**
 * Receive a cashuB token and swap it at the mint.
 *
 * Swapping invalidates the sender's copy of the proofs, ensuring
 * only the receiver can spend them. The resulting proofs are stored
 * in localStorage.
 */
export async function receiveToken(
  wallet: Wallet,
  cashuToken: string,
): Promise<Proof[]> {
  const proofs = await wallet.receive(cashuToken);
  addProofs(proofs);
  return proofs;
}

/**
 * Encode stored proofs as a cashuB token string.
 * Useful for displaying the balance as a shareable token.
 */
export function encodeBalance(mintUrl: string): string | null {
  const proofs = loadProofs();
  if (proofs.length === 0) return null;
  return getEncodedToken({ mint: mintUrl, proofs });
}

/**
 * Select proofs for a given amount (greedy largest-first).
 * Returns selected proofs and updates storage to remove them.
 */
export function selectProofs(amountSats: number): Proof[] | null {
  const proofs = loadProofs();
  const sorted = [...proofs].sort((a, b) => b.amount - a.amount);

  const selected: Proof[] = [];
  let total = 0;

  for (const p of sorted) {
    if (total >= amountSats) break;
    selected.push(p);
    total += p.amount;
  }

  if (total < amountSats) return null;

  // Remove selected from storage
  removeProofs(selected);
  return selected;
}
