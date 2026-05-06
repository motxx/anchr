/**
 * NIP-60 — Cashu Wallet over Nostr.
 *
 * Stores Cashu proofs as encrypted Nostr events instead of localStorage.
 * The user owns their wallet via their Nostr keypair; any client with the
 * nsec can load the same wallet by reading kind:7375 events from the
 * configured relays.
 *
 * Event kinds:
 *  - 17375 (replaceable): wallet config. Content is NIP-44(self → self) of
 *    an array of [tag, ...values] pairs: `[["mint", "url"], ["privkey", "hex"]]`.
 *  - 7375: token event. Content is NIP-44(self → self) of
 *    `{ mint: string, proofs: Proof[], del?: string[] }` where `del` lists
 *    prior token-event ids that this event supersedes (append-only state).
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/60.md
 */

import { type Proof } from "@cashu/cashu-ts";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { nip44 } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

export const NIP60_WALLET_KIND = 17375;
export const NIP60_TOKEN_KIND = 7375;

export interface Nip60Wallet {
  mintUrl: string;
  /** Caller's Nostr secret key (32 bytes). */
  secretKey: Uint8Array;
  /** Caller's Nostr public key (hex, x-only). */
  pubkey: string;
  /** Relays the wallet syncs to. */
  relays: string[];
  pool: SimplePool;
}

export interface TokenEntry {
  /** Source kind:7375 event id (used in `del` for replacement). */
  eventId: string;
  mint: string;
  proofs: Proof[];
}

export interface DecryptedTokenContent {
  mint: string;
  proofs: Proof[];
  del?: string[];
}

export interface CreateWalletInput {
  secretKey: Uint8Array;
  relays: string[];
  mintUrl: string;
  /** Existing pool to reuse; otherwise a fresh one is created. */
  pool?: SimplePool;
}

export async function createNip60Wallet(input: CreateWalletInput): Promise<Nip60Wallet> {
  const wallet: Nip60Wallet = {
    secretKey: input.secretKey,
    pubkey: getPublicKey(input.secretKey),
    relays: input.relays,
    mintUrl: input.mintUrl,
    pool: input.pool ?? new SimplePool(),
  };
  await publishWalletConfig(wallet);
  return wallet;
}

/** Publish (or replace) the kind:17375 wallet config event. */
export async function publishWalletConfig(wallet: Nip60Wallet): Promise<string> {
  const tags: Array<[string, string]> = [
    ["mint", wallet.mintUrl],
  ];
  const content = encryptToSelf(wallet, JSON.stringify(tags));
  const event = finalizeEvent(
    {
      kind: NIP60_WALLET_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content,
    },
    wallet.secretKey,
  );
  await publishToRelays(wallet, event);
  return event.id;
}

/** Publish a new kind:7375 token event covering `proofs`. */
export async function publishProofs(
  wallet: Nip60Wallet,
  proofs: Proof[],
  supersededEventIds: string[] = [],
): Promise<string> {
  const payload: DecryptedTokenContent = {
    mint: wallet.mintUrl,
    proofs,
    ...(supersededEventIds.length > 0 ? { del: supersededEventIds } : {}),
  };
  const content = encryptToSelf(wallet, JSON.stringify(payload));
  const event = finalizeEvent(
    {
      kind: NIP60_TOKEN_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content,
    },
    wallet.secretKey,
  );
  await publishToRelays(wallet, event);
  return event.id;
}

/**
 * Load all unspent token events for this wallet's pubkey. Decrypts each
 * event, walks the `del` chain in reverse-chronological order, and returns
 * the surviving (non-superseded) entries.
 */
export async function loadProofs(wallet: Nip60Wallet): Promise<TokenEntry[]> {
  const filter: Filter = {
    kinds: [NIP60_TOKEN_KIND],
    authors: [wallet.pubkey],
  };
  const events = await wallet.pool.querySync(wallet.relays, filter);
  // Sort for deterministic output. Replacement correctness does not depend on
  // this order because relays only expose second-resolution `created_at`.
  events.sort((a, b) => b.created_at - a.created_at);

  const tombstoned = new Set<string>();
  const entries: TokenEntry[] = [];
  for (const ev of events) {
    let payload: DecryptedTokenContent;
    try {
      const decrypted = decryptToSelf(wallet, ev.content);
      payload = JSON.parse(decrypted) as DecryptedTokenContent;
    } catch (err) {
      console.warn(`[nip60] skipping undecryptable token event ${ev.id.slice(0, 8)}:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (payload.del) {
      for (const id of payload.del) tombstoned.add(id);
    }
    entries.push({ eventId: ev.id, mint: payload.mint, proofs: payload.proofs });
  }
  return entries.filter((entry) => !tombstoned.has(entry.eventId));
}

/** Aggregate balance across all unspent token events for a single mint. */
export async function getBalance(wallet: Nip60Wallet): Promise<number> {
  const entries = await loadProofs(wallet);
  let total = 0;
  for (const e of entries) {
    if (e.mint !== wallet.mintUrl) continue;
    for (const p of e.proofs) total += p.amount;
  }
  return total;
}

// NIP-44 v2, self → self conversation key.
function encryptToSelf(wallet: Nip60Wallet, plaintext: string): string {
  const key = nip44.v2.utils.getConversationKey(wallet.secretKey, wallet.pubkey);
  return nip44.v2.encrypt(plaintext, key);
}

function decryptToSelf(wallet: Nip60Wallet, ciphertext: string): string {
  const key = nip44.v2.utils.getConversationKey(wallet.secretKey, wallet.pubkey);
  return nip44.v2.decrypt(ciphertext, key);
}

async function publishToRelays(wallet: Nip60Wallet, event: Event): Promise<void> {
  // Promise.allSettled so a single failed relay doesn't drop the publish.
  const promises = wallet.pool.publish(wallet.relays, event);
  await Promise.allSettled(promises);
}

/**
 * Close pool connections — call when the wallet is no longer needed.
 *
 * SimplePool.close fires the close on each relay's websocket but doesn't
 * await the closing handshake. The trailing await yields to the event loop
 * so the WS shutdown can flush before any test resource sanitizer runs.
 */
export async function closeNip60Wallet(wallet: Nip60Wallet): Promise<void> {
  wallet.pool.close(wallet.relays);
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
}
