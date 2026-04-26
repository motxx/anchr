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
import { createLockedToken, type ExchangeConfig } from "../src/exchange-protocol.ts";

const PROOF_STORAGE_KEY = "anchr_market_proofs";
const RECEIVED_TOKENS_KEY = "anchr_market_received_tokens";

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

// ---------------------------------------------------------------------------
// Bet → P2PK exchange flow
// ---------------------------------------------------------------------------

/**
 * Build the exchange-locked Cashu token for a matched bet pair.
 *
 * The browser owns the proofs; the server only relays the resulting
 * cashuB token between matched bettors. The token is locked so the
 * counterparty (and the market group) need to co-sign to spend it,
 * with a refund-after-locktime path back to the user.
 */
export async function lockFundsForMatch(input: {
  mintUrl: string;
  myPubkey: string;
  mySide: "yes" | "no";
  counterpartyPubkey: string;
  groupPubkeyYes: string;
  groupPubkeyNo: string;
  exchangeLocktime: number;
  marketLocktime: number;
  amountSats: number;
}): Promise<{ token: string }> {
  const wallet = await initWallet(input.mintUrl);
  const proofs = selectProofs(input.amountSats);
  if (!proofs) {
    throw new Error(
      `Insufficient balance: need ${input.amountSats} sats, have ${getBalance()}`,
    );
  }

  const config: ExchangeConfig = {
    mintUrl: input.mintUrl,
    marketGroupPubkeyYes: input.groupPubkeyYes,
    marketGroupPubkeyNo: input.groupPubkeyNo,
    myPubkey: input.myPubkey,
    mySide: input.mySide,
    counterpartyPubkey: input.counterpartyPubkey,
    amountSats: input.amountSats,
    exchangeLocktime: input.exchangeLocktime,
    marketLocktime: input.marketLocktime,
  };

  try {
    const result = await createLockedToken(wallet, proofs, config);
    return { token: result.token };
  } catch (err) {
    // Restore proofs on failure so the user doesn't lose their balance.
    addProofs(proofs);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Received tokens (locked tokens the user holds against a counterparty)
// ---------------------------------------------------------------------------

export interface HeldToken {
  market_id: string;
  pair_id: string;
  /** Side this user bet on. Token is redeemable when this side wins. */
  my_side: "yes" | "no";
  amount_sats: number;
  cashu_token: string;
  /** When this match was locked (for UI sorting). */
  received_at: number;
}

export function loadHeldTokens(): HeldToken[] {
  try {
    const raw = localStorage.getItem(RECEIVED_TOKENS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HeldToken[];
  } catch {
    return [];
  }
}

export function saveHeldToken(token: HeldToken): void {
  const existing = loadHeldTokens();
  // Replace any prior entry for the same pair (e.g. retry).
  const filtered = existing.filter((t) => t.pair_id !== token.pair_id);
  filtered.push(token);
  localStorage.setItem(RECEIVED_TOKENS_KEY, JSON.stringify(filtered));
}

export function loadHeldTokensForMarket(marketId: string): HeldToken[] {
  return loadHeldTokens().filter((t) => t.market_id === marketId);
}

export function removeHeldToken(pairId: string): void {
  const filtered = loadHeldTokens().filter((t) => t.pair_id !== pairId);
  localStorage.setItem(RECEIVED_TOKENS_KEY, JSON.stringify(filtered));
}
