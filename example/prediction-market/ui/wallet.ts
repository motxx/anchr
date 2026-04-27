/**
 * Browser-side Cashu wallet for non-custodial prediction market.
 *
 * When the server advertises Nostr relays in `/markets/wallet/config`, the
 * wallet stores Cashu proofs as encrypted NIP-60 `kind:7375` events on
 * those relays. The user's nsec (from `keypair.ts`) signs the events; only
 * the user can decrypt them. State persists across browsers as long as the
 * same nsec is configured.
 *
 * When no relays are configured, the wallet falls back to localStorage so
 * a single-browser demo flow still works without any Nostr setup.
 *
 * The wallet uses `@cashu/cashu-ts` for the actual mint interaction —
 * minting, swapping, locking via P2PK — and delegates persistence to NIP-60
 * (or localStorage) on top.
 */

import { type Proof, type Wallet } from "@cashu/cashu-ts";
import { createLockedToken, type ExchangeConfig } from "../src/exchange-protocol.ts";
import { getOrCreateKeypair } from "./keypair.ts";
import {
  createNip60Wallet,
  loadProofs as loadNip60Proofs,
  publishProofs as publishNip60Proofs,
  type Nip60Wallet,
  type TokenEntry,
} from "../src/nip60.ts";

const PROOF_STORAGE_KEY = "anchr_market_proofs";
const RECEIVED_TOKENS_KEY = "anchr_market_received_tokens";

// ---------------------------------------------------------------------------
// Wallet initialization
// ---------------------------------------------------------------------------

let _wallet: Wallet | null = null;
let _mintUrl: string | null = null;
let _nip60: Nip60Wallet | null = null;
let _relays: string[] = [];

/**
 * Initialize the browser-side Cashu wallet. Call this once at app startup
 * with the values from `/markets/wallet/config`.
 *
 * `relays = []` keeps the wallet in localStorage-only mode.
 */
export async function initWallet(
  mintUrl: string,
  relays: string[] = [],
): Promise<Wallet> {
  if (_wallet && _mintUrl === mintUrl && relays.join(",") === _relays.join(",")) {
    return _wallet;
  }
  // Dynamic import keeps the cashu-ts bundle lazy in case the wallet path
  // is never used.
  const { Wallet: CashuWallet } = await import("@cashu/cashu-ts");
  _wallet = new CashuWallet(mintUrl, { unit: "sat" });
  _mintUrl = mintUrl;
  await _wallet.loadMint();

  _relays = relays;
  if (relays.length > 0) {
    const { secretKey } = getOrCreateKeypair();
    _nip60 = await createNip60Wallet({ secretKey, relays, mintUrl });
  } else {
    _nip60 = null;
  }
  return _wallet;
}

export function getWallet(): Wallet | null {
  return _wallet;
}

export function getMintUrl(): string | null {
  return _mintUrl;
}

/** True if the wallet is persisting to a Nostr relay (NIP-60 mode). */
export function isNostrBacked(): boolean {
  return _nip60 !== null;
}

// ---------------------------------------------------------------------------
// Proof storage — NIP-60 if available, localStorage fallback
// ---------------------------------------------------------------------------

/** All live token entries for this wallet (NIP-60 form). */
async function loadEntries(): Promise<TokenEntry[]> {
  if (_nip60) return loadNip60Proofs(_nip60);
  // localStorage fallback wraps the flat proof list as a single synthetic
  // entry. The eventId is empty — there's nothing to supersede in this mode.
  return [{ eventId: "", mint: _mintUrl ?? "", proofs: loadProofsLocal() }];
}

function loadProofsLocal(): Proof[] {
  try {
    const raw = localStorage.getItem(PROOF_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Proof[];
  } catch {
    return [];
  }
}

function saveProofsLocal(proofs: Proof[]): void {
  localStorage.setItem(PROOF_STORAGE_KEY, JSON.stringify(proofs));
}

/** Read all proofs the wallet considers spendable right now. */
export async function loadProofs(): Promise<Proof[]> {
  const entries = await loadEntries();
  return entries.flatMap((e) => e.proofs);
}

/** Replace the wallet's proof set. NIP-60 mode supersedes prior events. */
export async function saveProofs(proofs: Proof[]): Promise<void> {
  if (_nip60) {
    const entries = await loadNip60Proofs(_nip60);
    await publishNip60Proofs(_nip60, proofs, entries.map((e) => e.eventId));
  } else {
    saveProofsLocal(proofs);
  }
}

export async function getBalance(): Promise<number> {
  const proofs = await loadProofs();
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

export async function addProofs(newProofs: Proof[]): Promise<void> {
  const existing = await loadProofs();
  await saveProofs([...existing, ...newProofs]);
}

export async function removeProofs(spentProofs: Proof[]): Promise<void> {
  const existing = await loadProofs();
  const spentCs = new Set(spentProofs.map((p) => p.C));
  await saveProofs(existing.filter((p) => !spentCs.has(p.C)));
}

// ---------------------------------------------------------------------------
// Token operations
// ---------------------------------------------------------------------------

/** Receive a cashuB token, swap it at the mint, and add the proofs to the wallet. */
export async function receiveToken(
  wallet: Wallet,
  cashuToken: string,
): Promise<Proof[]> {
  const proofs = await wallet.receive(cashuToken);
  await addProofs(proofs);
  return proofs;
}

// ---------------------------------------------------------------------------
// Bet → P2PK exchange flow
// ---------------------------------------------------------------------------

/**
 * Build the P2PK-locked Cashu token for a matched bet pair.
 *
 * The browser owns the proofs; the server only relays the resulting cashuB
 * token between matched bettors. The token locks until the market deadline
 * + buffer, with a refund-after-locktime path back to the user.
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
  const wallet = await initWallet(input.mintUrl, _relays);
  const entries = await loadEntries();
  const allProofs = entries.flatMap((e) => e.proofs);
  const balance = allProofs.reduce((s, p) => s + p.amount, 0);
  if (balance < input.amountSats) {
    throw new Error(
      `Insufficient balance: need ${input.amountSats} sats, have ${balance}`,
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

  // The lock op may throw if cashu-ts can't make the math work; in that
  // case we leave proofs untouched. On success, the wallet's `keep` set
  // becomes the new spendable balance.
  const result = await createLockedToken(wallet, allProofs, config);

  if (_nip60) {
    await publishNip60Proofs(
      _nip60,
      result.keepProofs,
      entries.map((e) => e.eventId),
    );
  } else {
    saveProofsLocal(result.keepProofs);
  }

  return { token: result.token };
}

// ---------------------------------------------------------------------------
// Held tokens (locked tokens the user holds against a counterparty)
//
// Held tokens are large strings (cashuB-encoded) and would bloat the kind
// :7375 event. They live in localStorage for now; the resolution-redemption
// path will pick them up, swap to plain proofs, and write the proofs back
// via the regular saveProofs() above.
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
