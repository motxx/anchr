/**
 * Browser-side Cashu wallet for non-custodial two-party binary bet.
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

import {
  type Proof,
  type Wallet,
  getDecodedToken,
  getEncodedToken,
  signP2PKProofs,
} from "@cashu/cashu-ts";
import { createLockedToken, type ExchangeConfig } from "../src/exchange-protocol.ts";
import { getOrCreateKeypair } from "./keypair.ts";
import {
  createNip60Wallet,
  loadProofs as loadNip60Proofs,
  publishProofs as publishNip60Proofs,
  type Nip60Wallet,
  type TokenEntry,
} from "../src/nip60.ts";
import {
  fetchIncomingNutzaps,
  redeemNutzap,
  sendNutzap as sendNutzapPrimitive,
  type IncomingNutzap,
} from "../src/nip61.ts";
import { signProofs } from "./api.ts";

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
  const { Wallet: CashuWallet } = await import("@cashu/cashu-ts"); // allow-dynamic-import: keeps the cashu-ts bundle lazy — viewers who never open the wallet panel skip the download
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
// Resolution → redemption
//
// After the market resolves, the winner holds the LOSER's P2PK-locked
// token (received at match time and stored in HeldTokens). The path to
// take the sats:
//   1. Decode the held cashuB token → proofs.
//   2. Submit proof.secret values to /sign-proofs — server returns one
//      Schnorr signature per secret signed with the winning outcome's key.
//   3. Pre-fill each proof.witness with the oracle signature.
//   4. signP2PKProofs(proofs, user_sk) — adds the user's signature, so the
//      witness now satisfies n_sigs=2 (oracle + user).
//   5. Re-encode as a token and call wallet.receive() — the mint swaps
//      the locked proofs for plain proofs in the user's denomination set.
//   6. Save the new plain proofs through the same NIP-60 / localStorage
//      path as everything else (saveProofs).
//
// Result: the winner's Cashu balance grows by the loser's locked amount
// minus the mint's swap fee. Verified end-to-end in
// e2e/redemption-flow.test.ts.
// ---------------------------------------------------------------------------

export interface RedemptionResult {
  /** How many of the user's pairs in this market settled to plain proofs. */
  redeemed_pairs: number;
  /** Total sats added back to the wallet across all redeemed pairs. */
  total_sats: number;
  /** Per-pair details for the UI to show "+1,000 sats from pair X". */
  redemptions: Array<{ pair_id: string; amount_sats: number }>;
  /** Pairs that this user holds tokens for but the wallet/oracle couldn't redeem. */
  failures: Array<{ pair_id: string; error: string }>;
}

/**
 * Redeem all of this user's winning pairs in `marketId` and add the
 * resulting plain proofs to the wallet.
 *
 * Idempotent only at the wallet level — calling twice may double-spend
 * proofs that are already swapped, so the UI should clear HeldTokens for
 * pairs that succeeded. (The mint will reject the second swap, so funds
 * aren't at risk; the call just returns failures.)
 */
export async function redeemMarketWinnings(
  marketId: string,
  mintUrl: string,
): Promise<RedemptionResult> {
  const wallet = await initWallet(mintUrl, _relays);
  const { secretKey, publicKey: userPubkey } = getOrCreateKeypair();
  const skHex = bytesToHex(secretKey);

  const held = loadHeldTokensForMarket(marketId);
  if (held.length === 0) {
    return { redeemed_pairs: 0, total_sats: 0, redemptions: [], failures: [] };
  }

  const knownKeysetIds = wallet.keyChain?.getAllKeysetIds?.() ?? [];

  let totalSats = 0;
  const redemptions: Array<{ pair_id: string; amount_sats: number }> = [];
  const failures: Array<{ pair_id: string; error: string }> = [];

  for (const tok of held) {
    try {
      const decoded = getDecodedToken(tok.cashu_token, knownKeysetIds);
      const proofs = decoded.proofs;
      if (proofs.length === 0) {
        failures.push({ pair_id: tok.pair_id, error: "Held token has no proofs" });
        continue;
      }

      // Ask the oracle to sign each proof's secret with the winning outcome's key.
      const secrets = proofs.map((p) => p.secret);
      const signResult = await signProofs(marketId, userPubkey, secrets);
      if (signResult.signed_count < secrets.length) {
        failures.push({
          pair_id: tok.pair_id,
          error: `Oracle signed only ${signResult.signed_count}/${secrets.length} proofs`,
        });
        continue;
      }

      // Pre-fill witness with the oracle's signature; signP2PKProofs appends
      // the user's signature → n_sigs=2 satisfied.
      const proofsWithOracleSig = proofs.map((p) => ({
        ...p,
        witness: JSON.stringify({
          signatures: [signResult.oracle_signatures[p.secret]],
        }),
      }));
      const fullySigned = signP2PKProofs(proofsWithOracleSig, skHex);

      // Re-encode and have the wallet swap at the mint. wallet.receive
      // returns the freshly-swapped plain proofs.
      const reencoded = getEncodedToken({ mint: mintUrl, proofs: fullySigned });
      const fresh = await wallet.receive(reencoded);
      const sats = fresh.reduce((s, p) => s + p.amount, 0);

      // Persist the new plain proofs through the same path as everything else.
      await addProofs(fresh);
      removeHeldToken(tok.pair_id);

      totalSats += sats;
      redemptions.push({ pair_id: tok.pair_id, amount_sats: sats });
    } catch (err) {
      failures.push({
        pair_id: tok.pair_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { redeemed_pairs: redemptions.length, total_sats: totalSats, redemptions, failures };
}

// Local hex helper — keypair.ts has its own; duplicated here to avoid a
// circular import (this file imports keypair, keypair imports nothing).
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// NIP-61 nutzaps — funding & sending
// ---------------------------------------------------------------------------

export interface NutzapReceiveResult {
  /** How many nutzaps successfully redeemed and added to the wallet. */
  redeemed: number;
  /** Total sats added across the redeemed nutzaps (after mint swap fee). */
  total_sats: number;
  /** Per-nutzap detail for the UI to show "+1,000 sats from <pubkey>". */
  redemptions: Array<{ event_id: string; sender_pubkey: string; amount_sats: number; comment?: string }>;
  /** Nutzaps that failed to redeem (already-spent, wrong mint, etc.). */
  failures: Array<{ event_id: string; error: string }>;
}

/**
 * Pull all unredeemed NIP-61 nutzaps targeting this user's pubkey from
 * the configured relays, swap each at the mint, and persist the
 * resulting plain proofs through the same NIP-60 / localStorage path.
 *
 * Idempotency is delegated to the mint — already-spent locks reject the
 * second swap, so calling twice is safe (the second call just records
 * failures).
 */
export async function receiveIncomingNutzaps(
  mintUrl: string,
): Promise<NutzapReceiveResult> {
  const wallet = await initWallet(mintUrl, _relays);
  const { secretKey, publicKey } = getOrCreateKeypair();
  if (_relays.length === 0) {
    return { redeemed: 0, total_sats: 0, redemptions: [], failures: [] };
  }
  if (_nip60 === null) {
    // Defensive — initWallet sets _nip60 when relays are configured, but
    // a misconfiguration shouldn't crash the wallet.
    return { redeemed: 0, total_sats: 0, redemptions: [], failures: [] };
  }

  const nutzaps = await fetchIncomingNutzaps(_nip60.pool, _relays, publicKey);

  let totalSats = 0;
  const redemptions: NutzapReceiveResult["redemptions"] = [];
  const failures: NutzapReceiveResult["failures"] = [];

  for (const nz of nutzaps) {
    if (nz.mintUrl !== mintUrl) {
      failures.push({ event_id: nz.eventId, error: `Wrong mint: ${nz.mintUrl}` });
      continue;
    }
    try {
      const fresh = await redeemNutzap({
        recipientWallet: wallet,
        recipientSecret: secretKey,
        nutzap: nz,
      });
      const sats = fresh.reduce((s, p) => s + p.amount, 0);
      await addProofs(fresh);
      totalSats += sats;
      redemptions.push({
        event_id: nz.eventId,
        sender_pubkey: nz.senderPubkey,
        amount_sats: sats,
        comment: nz.comment,
      });
    } catch (err) {
      failures.push({
        event_id: nz.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { redeemed: redemptions.length, total_sats: totalSats, redemptions, failures };
}

/**
 * Send a NIP-61 nutzap to `recipientPubkey`. Locks `amountSats` from the
 * wallet's plain proofs and publishes a kind:9321 event tagged with the
 * recipient. Wallet's proof pool is updated with the change.
 */
export async function sendNutzap(input: {
  mintUrl: string;
  recipientPubkey: string;
  amountSats: number;
  comment?: string;
}): Promise<{ event_id: string }> {
  const wallet = await initWallet(input.mintUrl, _relays);
  const { secretKey } = getOrCreateKeypair();
  if (_relays.length === 0 || _nip60 === null) {
    throw new Error("Nutzap requires NOSTR_RELAYS to be configured on the server");
  }

  const senderProofs = await loadProofs();
  const result = await sendNutzapPrimitive({
    senderSecret: secretKey,
    recipientPubkey: input.recipientPubkey,
    mintUrl: input.mintUrl,
    senderWallet: wallet,
    senderProofs,
    amountSats: input.amountSats,
    relays: _relays,
    comment: input.comment,
    pool: _nip60.pool,
  });

  // Replace the wallet's plain proofs with the change keepProofs.
  await saveProofs(result.keepProofs);
  return { event_id: result.eventId };
}

// Tag for IDEs that don't see the IncomingNutzap re-export.
export type { IncomingNutzap };

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
