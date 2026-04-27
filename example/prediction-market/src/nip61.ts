/**
 * NIP-61 — Nutzaps. Cashu-based payments delivered via Nostr events.
 *
 * Sender locks Cashu proofs to the recipient's Nostr pubkey using NUT-11
 * P2PK, publishes the locked token in a `kind:9321` event tagged with the
 * recipient's pubkey. Recipient subscribes to `#p`-tagged kind:9321
 * events, swaps the locked proofs at the mint with their nsec, and the
 * resulting plain proofs flow into their NIP-60 wallet.
 *
 * No new crypto — reuses the same NUT-11 P2PK lock that the prediction
 * market exchange path already builds, with `n_sigs=1` and the recipient
 * as the sole authorized signer.
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/61.md
 */

import {
  P2PKBuilder,
  type Proof,
  type Wallet,
  getDecodedToken,
  getEncodedToken,
} from "@cashu/cashu-ts";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Filter } from "nostr-tools/filter";
import { SimplePool } from "nostr-tools/pool";

export const NIP61_NUTZAP_KIND = 9321;

export interface NutzapInput {
  /** Sender's nsec (32 bytes). */
  senderSecret: Uint8Array;
  /** Recipient's Nostr public key (hex, x-only). */
  recipientPubkey: string;
  /** Mint URL — both sender and recipient must trust this mint. */
  mintUrl: string;
  /** Sender's wallet on the mint. */
  senderWallet: Wallet;
  /** Plain proofs to lock + send. */
  senderProofs: Proof[];
  /** Amount in sats to send. */
  amountSats: number;
  /** Relays to publish the kind:9321 event to. */
  relays: string[];
  /** Optional human-readable note (in plaintext, since nutzaps are public). */
  comment?: string;
  /** Existing pool to reuse; otherwise a fresh one is created. */
  pool?: SimplePool;
}

export interface NutzapSendResult {
  /** Event id of the published kind:9321 event. */
  eventId: string;
  /** Plain proofs the wallet kept back as change. */
  keepProofs: Proof[];
}

/**
 * Send a nutzap. Locks `amountSats` to the recipient's pubkey, publishes
 * the locked token as a kind:9321 event tagged with the recipient.
 */
export async function sendNutzap(input: NutzapInput): Promise<NutzapSendResult> {
  const senderPubkey = getPublicKey(input.senderSecret);
  const pool = input.pool ?? new SimplePool();

  // Lock proofs to recipient's pubkey via NUT-11 P2PK. n_sigs=1 — only
  // the recipient needs to sign at swap time. No locktime: nutzaps are
  // unconditional gifts; the sender does not retain refund rights.
  const lockOptions = new P2PKBuilder()
    .addLockPubkey(input.recipientPubkey)
    .requireLockSignatures(1)
    .toOptions();

  await input.senderWallet.loadMint(true);
  const { send, keep } = await input.senderWallet.ops
    .send(input.amountSats, input.senderProofs)
    .asP2PK(lockOptions)
    .run();

  const lockedToken = getEncodedToken({ mint: input.mintUrl, proofs: send });

  // Publish the kind:9321 event. Tags follow NIP-61: ["p", recipient]
  // for filtering, ["amount", "<sats>"], ["u", mintUrl]. Content is the
  // locked cashuB token plus an optional plaintext comment.
  const tags: string[][] = [
    ["p", input.recipientPubkey],
    ["amount", String(input.amountSats)],
    ["u", input.mintUrl],
  ];
  const content = input.comment ? `${lockedToken}\n${input.comment}` : lockedToken;
  const event = finalizeEvent(
    {
      kind: NIP61_NUTZAP_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    },
    input.senderSecret,
  );

  const promises = pool.publish(input.relays, event);
  await Promise.allSettled(promises);

  // Tag for transparency / debugging — also satisfies a few linters.
  void senderPubkey;

  return { eventId: event.id, keepProofs: keep ?? [] };
}

// ---------------------------------------------------------------------------
// Recipient side
// ---------------------------------------------------------------------------

export interface IncomingNutzap {
  eventId: string;
  senderPubkey: string;
  amountSats: number;
  mintUrl: string;
  /** Locked cashuB token. Recipient swaps this at the mint. */
  lockedToken: string;
  comment?: string;
}

/**
 * One-shot fetch of all nutzaps targeted at `recipientPubkey` since
 * `since` (unix seconds, exclusive). Useful at startup; for live updates
 * use `subscribeIncomingNutzaps`.
 */
export async function fetchIncomingNutzaps(
  pool: SimplePool,
  relays: string[],
  recipientPubkey: string,
  since?: number,
): Promise<IncomingNutzap[]> {
  const filter: Filter = {
    kinds: [NIP61_NUTZAP_KIND],
    "#p": [recipientPubkey],
    ...(since ? { since: since + 1 } : {}),
  };
  const events = await pool.querySync(relays, filter);
  return events.map(parseNutzapEvent).filter((n): n is IncomingNutzap => n !== null);
}

function parseNutzapEvent(event: {
  id: string;
  pubkey: string;
  tags: string[][];
  content: string;
}): IncomingNutzap | null {
  const amountTag = event.tags.find((t) => t[0] === "amount");
  const mintTag = event.tags.find((t) => t[0] === "u");
  if (!amountTag || !mintTag) return null;
  const amountSats = Number(amountTag[1]);
  if (!Number.isFinite(amountSats) || amountSats <= 0) return null;

  // Content is `cashuB...` optionally followed by `\n<comment>`. Split
  // on the first newline so the comment can contain whitespace freely.
  const newlineIdx = event.content.indexOf("\n");
  const lockedToken = newlineIdx >= 0 ? event.content.slice(0, newlineIdx) : event.content;
  const comment = newlineIdx >= 0 ? event.content.slice(newlineIdx + 1) : undefined;
  if (!lockedToken.startsWith("cashuB") && !lockedToken.startsWith("cashuA")) return null;

  return {
    eventId: event.id,
    senderPubkey: event.pubkey,
    amountSats,
    mintUrl: mintTag[1] ?? "",
    lockedToken,
    comment,
  };
}

export interface RedeemNutzapInput {
  recipientWallet: Wallet;
  recipientSecret: Uint8Array;
  nutzap: IncomingNutzap;
}

/**
 * Swap a locked nutzap for plain proofs in the recipient's wallet.
 * Returns the freshly-swapped proofs the caller must persist (e.g. via
 * NIP-60 publishProofs or wallet.saveProofs).
 */
export async function redeemNutzap(input: RedeemNutzapInput): Promise<Proof[]> {
  await input.recipientWallet.loadMint(true);
  const knownKeysetIds = input.recipientWallet.keyChain?.getAllKeysetIds?.() ?? [];
  const decoded = getDecodedToken(input.nutzap.lockedToken, knownKeysetIds);
  if (decoded.proofs.length === 0) {
    throw new Error("Nutzap token has no proofs");
  }
  // wallet.receive accepts the cashuB string and a privkey for P2PK locks.
  // cashu-ts will sign each proof's secret with the privkey (n_sigs=1
  // satisfied) and submit the swap.
  return input.recipientWallet.receive(input.nutzap.lockedToken, {
    privkey: bytesToHex(input.recipientSecret),
  });
}
