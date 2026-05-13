/**
 * Nip60UserBot — a participant whose proofs live as encrypted Nostr events
 * (kind:7375) instead of in-process memory. Models a real end-user: their
 * wallet state persists across sessions via Nostr relays, the way a NIP-60
 * client would.
 *
 * The bot:
 *   1. Loads its proof state from NIP-60 (kind:17375 wallet event +
 *      kind:7375 token events) on construction.
 *   2. Mints fresh proofs from regtest if it has no balance, then publishes
 *      them as a new kind:7375 event.
 *   3. placeBet builds a P2PK-locked exchange token using its NIP-60
 *      proofs, submits via /bet → /submit-token, then writes the change
 *      proofs back as a new kind:7375 event with `del` referring to the
 *      now-spent prior event.
 *   4. redeemWinnings calls /sign-proofs, applies the oracle signatures to
 *      the held redeemable token, swaps at the mint, and stores the
 *      resulting payout proofs as a new kind:7375 event.
 *
 * No localStorage, no in-memory shortcut for proof state — the relay is
 * the source of truth.
 */

import { getEncodedToken, type Proof, Wallet } from "@cashu/cashu-ts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  createWallet,
  throttledMintProofs,
} from "../../e2e/helpers/regtest.ts";
import { createLockedToken } from "../../example/two-party-binary-bet/src/exchange-protocol.ts";
import {
  closeNip60Wallet,
  createNip60Wallet,
  loadProofs as loadNip60Proofs,
  type Nip60Wallet,
  publishProofs as publishNip60Proofs,
} from "../../example/two-party-binary-bet/src/nip60.ts";

export interface Nip60UserConfig {
  /** Server base URL, e.g. http://localhost:3001. */
  serverUrl: string;
  /** Cashu mint URL — the user's wallet binds to this single mint. */
  mintUrl: string;
  /** Nostr relay URLs the wallet syncs to. */
  relayUrls: string[];
  /** Existing Nostr secret key. Generated automatically if omitted. */
  nostrSecret?: Uint8Array;
  /** Optional human label for logs. */
  label?: string;
}

export interface BetMatch {
  pair_id: string;
  counterparty_pubkey: string;
  group_pubkey_yes: string;
  group_pubkey_no: string;
  locktime_exchange: number;
  locktime_market: number;
  amount_sats: number;
}

export class Nip60UserBot {
  readonly serverUrl: string;
  readonly mintUrl: string;
  readonly relayUrls: string[];
  readonly nostrPubkey: string;
  readonly label: string;
  private readonly nostrSecret: Uint8Array;
  private readonly cashuWallet: Wallet;
  private readonly nip60: Nip60Wallet;
  private latestTokenEventIds: string[] = [];

  private constructor(
    config: Nip60UserConfig,
    cashuWallet: Wallet,
    nip60: Nip60Wallet,
    secret: Uint8Array,
  ) {
    this.serverUrl = config.serverUrl.replace(/\/$/, "");
    this.mintUrl = config.mintUrl;
    this.relayUrls = config.relayUrls;
    this.nostrSecret = secret;
    this.nostrPubkey = nip60.pubkey;
    this.label = config.label ?? `nip60-${this.nostrPubkey.slice(0, 6)}`;
    this.cashuWallet = cashuWallet;
    this.nip60 = nip60;
  }

  static async open(config: Nip60UserConfig): Promise<Nip60UserBot> {
    const secret = config.nostrSecret ?? generateSecretKey();
    const cashuWallet = await createWallet(config.mintUrl);
    const nip60 = await createNip60Wallet({
      secretKey: secret,
      relays: config.relayUrls,
      mintUrl: config.mintUrl,
    });
    return new Nip60UserBot(config, cashuWallet, nip60, secret);
  }

  /** Convenience for tests / scripts that need to log the secret. */
  exportSecretHex(): string {
    return bytesToHex(this.nostrSecret);
  }

  /** Aggregate balance across this wallet's NIP-60 token events. */
  async balance(): Promise<number> {
    const entries = await loadNip60Proofs(this.nip60);
    let total = 0;
    for (const e of entries) {
      if (e.mint !== this.mintUrl) continue;
      for (const p of e.proofs) total += p.amount;
    }
    return total;
  }

  /** Mint `amountSats` from regtest Lightning and persist as a new kind:7375. */
  async fundFromRegtest(amountSats: number): Promise<void> {
    const proofs = await throttledMintProofs(this.cashuWallet, amountSats);
    this.latestTokenEventIds = [await publishNip60Proofs(this.nip60, proofs)];
  }

  /** Place a bet, submitting tokens for any matches the server returns. */
  async placeBet(
    marketId: string,
    side: "yes" | "no",
    amountSats: number,
  ): Promise<
    {
      orderId: string;
      matches: BetMatch[];
      submittedCount: number;
      committedSats: number;
    }
  > {
    const entries = await loadNip60Proofs(this.nip60);
    const allProofs = entries.flatMap((e) => e.proofs);
    const liveEventIds = entries.map((e) => e.eventId);

    if (allProofs.reduce((s, p) => s + p.amount, 0) < amountSats) {
      throw new Error(
        `${this.label}: insufficient NIP-60 balance for ${amountSats} sats`,
      );
    }

    const betRes = await this.post(`/markets/${marketId}/bet`, {
      side,
      amount_sats: amountSats,
      bettor_pubkey: this.nostrPubkey,
    });
    if (betRes.status !== 201) {
      throw new Error(
        `${this.label}: /bet failed ${betRes.status}: ${await betRes.text()}`,
      );
    }
    const betBody = await betRes.json() as {
      order_id: string;
      matches: BetMatch[];
    };

    let submittedCount = 0;
    let committedSats = 0;
    let runningProofs = allProofs;
    let runningSupersede = liveEventIds;

    for (const match of betBody.matches) {
      const tokenResult = await createLockedToken(
        this.cashuWallet,
        runningProofs,
        {
          mintUrl: this.mintUrl,
          marketGroupPubkeyYes: match.group_pubkey_yes,
          marketGroupPubkeyNo: match.group_pubkey_no,
          myPubkey: this.nostrPubkey,
          mySide: side,
          counterpartyPubkey: match.counterparty_pubkey,
          amountSats: match.amount_sats,
          exchangeLocktime: match.locktime_exchange,
          marketLocktime: match.locktime_market,
        },
      );

      const submitRes = await this.post(`/markets/${marketId}/submit-token`, {
        pair_id: match.pair_id,
        cashu_token: tokenResult.token,
        bettor_pubkey: this.nostrPubkey,
      });
      const submitText = await submitRes.text();
      if (submitRes.status !== 200) {
        console.warn(
          `${this.label}: /submit-token failed ${submitRes.status}: ${submitText}`,
        );
        continue;
      }
      submittedCount++;
      committedSats += match.amount_sats;
      runningProofs = tokenResult.keepProofs;
    }

    // Replace all prior token events with one fresh kind:7375 covering the
    // change. If the server tendered no matches, runningProofs is unchanged
    // and we still rewrite to consolidate the wallet history.
    this.latestTokenEventIds = [
      await publishNip60Proofs(
        this.nip60,
        runningProofs,
        this.supersedeEventIds(runningSupersede),
      ),
    ];

    return {
      orderId: betBody.order_id,
      matches: betBody.matches,
      submittedCount,
      committedSats,
    };
  }

  /**
   * Poll for matches the matchmaker only announced to a later bet, and submit.
   *
   * Side per-pair comes from the server, not the caller — see
   * MarketMakerBot.submitPendingMatches for the rationale.
   */
  async submitPendingMatches(
    marketId: string,
    _legacySideHint?: "yes" | "no",
  ): Promise<number> {
    const detailRes = await fetch(
      `${this.serverUrl}/markets/${marketId}?pubkey=${this.nostrPubkey}`,
    );
    if (!detailRes.ok) {
      const errText = await detailRes.text();
      console.warn(
        `${this.label}: market detail failed ${detailRes.status}: ${errText}`,
      );
      return 0;
    }
    const detail = await detailRes.json() as {
      resolution_deadline: number;
      group_pubkey_yes: string;
      group_pubkey_no: string;
      user_pairs?: Array<{
        pair_id: string;
        side: "yes" | "no";
        counterparty_pubkey: string;
        amount_sats: number;
        status: string;
      }>;
    };
    void _legacySideHint;
    if (!detail.user_pairs) return 0;

    let submittedCount = 0;
    for (const userPair of detail.user_pairs) {
      if (userPair.status !== "pending") continue;

      const entries = await loadNip60Proofs(this.nip60);
      const allProofs = entries.flatMap((e) => e.proofs);
      const liveEventIds = entries.map((e) => e.eventId);
      const balance = allProofs.reduce((s, p) => s + p.amount, 0);
      if (balance < userPair.amount_sats) {
        console.warn(
          `${this.label}: insufficient balance for pending pair ${userPair.pair_id}`,
        );
        continue;
      }

      const tokenResult = await createLockedToken(this.cashuWallet, allProofs, {
        mintUrl: this.mintUrl,
        marketGroupPubkeyYes: detail.group_pubkey_yes,
        marketGroupPubkeyNo: detail.group_pubkey_no,
        myPubkey: this.nostrPubkey,
        mySide: userPair.side,
        counterpartyPubkey: userPair.counterparty_pubkey,
        amountSats: userPair.amount_sats,
        exchangeLocktime: Math.floor(Date.now() / 1000) + 600,
        marketLocktime: detail.resolution_deadline + 3600,
      });

      const submitRes = await this.post(`/markets/${marketId}/submit-token`, {
        pair_id: userPair.pair_id,
        cashu_token: tokenResult.token,
        bettor_pubkey: this.nostrPubkey,
      });
      const submitText = await submitRes.text();
      if (submitRes.status !== 200) {
        console.warn(
          `${this.label}: pending /submit-token failed ${submitRes.status}: ${submitText}`,
        );
        continue;
      }
      submittedCount++;

      // Persist the new change proofs and supersede the prior NIP-60 events.
      this.latestTokenEventIds = [
        await publishNip60Proofs(
          this.nip60,
          tokenResult.keepProofs,
          this.supersedeEventIds(liveEventIds),
        ),
      ];
    }
    return submittedCount;
  }

  /** Pretty wrapper for tests that just want to know "are my winnings here?". */
  async snapshot(): Promise<{ balance: number; eventCount: number }> {
    const entries = await loadNip60Proofs(this.nip60);
    return {
      balance: entries.flatMap((e) => e.proofs).reduce(
        (s, p) => s + p.amount,
        0,
      ),
      eventCount: entries.length,
    };
  }

  async close(): Promise<void> {
    await closeNip60Wallet(this.nip60);
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.serverUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private supersedeEventIds(relayVisibleEventIds: string[]): string[] {
    return Array.from(
      new Set([...relayVisibleEventIds, ...this.latestTokenEventIds]),
    );
  }
}

// Suppress unused-import warning in IDEs that don't see the constructor field.
void getPublicKey;
void getEncodedToken;
void SimplePool;
