/**
 * MarketMakerBot — a single end-to-end bot that participates in a Kannagi
 * prediction market with a real Cashu wallet, real proofs minted via the
 * regtest Lightning faucet, and real P2PK-locked exchange tokens.
 *
 * The bot owns:
 *   - a nostr-style x-only keypair (bettor_pubkey)
 *   - a Cashu Wallet bound to a single mint URL
 *   - a balance of plain proofs (minted from regtest Lightning)
 *
 * placeBet runs the full path:
 *   1. POST /markets/:id/bet → server returns matches
 *   2. for each match, build a P2PK-locked token via createLockedToken
 *      (single-phase, market locktime — see exchange-protocol.ts)
 *   3. POST /markets/:id/submit-token with the encoded cashuB string
 *
 * If the bet finds no counterparty, the order sits in the book; the next bot
 * to take the opposite side will match against it.
 */

import { Wallet, type Proof } from "@cashu/cashu-ts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  createWallet,
  throttledMintProofs,
} from "../../e2e/helpers/regtest.ts";
import { createLockedToken } from "../../example/prediction-market/src/exchange-protocol.ts";

export interface BotIdentity {
  /** Hex-encoded x-only public key. */
  pubkey: string;
  /** Hex-encoded private key (32 bytes). */
  secretHex: string;
}

export interface BotConfig {
  /** Server base URL, e.g. http://localhost:3001. */
  serverUrl: string;
  /** Cashu mint URL — the bot's wallet binds to this single mint. */
  mintUrl: string;
  /** Bot's identity (keypair). Generated automatically if omitted. */
  identity?: BotIdentity;
  /** Initial proof budget in sats. Minted upfront via Lightning. */
  initialFundingSats: number;
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

export interface BetResult {
  /** The order id assigned by the server. */
  orderId: string;
  /** Matches the server returned for this order. May be empty. */
  matches: BetMatch[];
  /** Number of matches whose token submitted successfully (status 200). */
  submittedCount: number;
  /** Sats actually committed (sum over successful submissions). */
  committedSats: number;
}

export class MarketMakerBot {
  readonly identity: BotIdentity;
  readonly label: string;
  readonly serverUrl: string;
  readonly mintUrl: string;
  private wallet!: Wallet;
  private proofs: Proof[] = [];
  private readonly initialFundingSats: number;

  private constructor(config: BotConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, "");
    this.mintUrl = config.mintUrl;
    this.identity = config.identity ?? generateBotIdentity();
    this.label = config.label ?? `bot_${this.identity.pubkey.slice(0, 6)}`;
    this.initialFundingSats = config.initialFundingSats;
  }

  /** Create a bot, fund it from the regtest Lightning faucet, and return it. */
  static async fund(config: BotConfig): Promise<MarketMakerBot> {
    const bot = new MarketMakerBot(config);
    bot.wallet = await createWallet(bot.mintUrl);
    bot.proofs = await throttledMintProofs(bot.wallet, bot.initialFundingSats);
    return bot;
  }

  balanceSats(): number {
    return this.proofs.reduce((s, p) => s + p.amount, 0);
  }

  /**
   * Place a bet on `marketId`. Returns the server's response and counts how
   * many matched-pair tokens were submitted successfully.
   *
   * The bot withholds proofs equal to the bet amount and locks them; if the
   * server returns multiple matches that together exceed the bet amount,
   * later matches that exceed the available locked amount are skipped.
   */
  async placeBet(
    marketId: string,
    side: "yes" | "no",
    amountSats: number,
  ): Promise<BetResult> {
    if (this.balanceSats() < amountSats) {
      throw new Error(
        `${this.label}: insufficient balance (${this.balanceSats()} < ${amountSats})`,
      );
    }

    const betRes = await this.post(`/markets/${marketId}/bet`, {
      side,
      amount_sats: amountSats,
      bettor_pubkey: this.identity.pubkey,
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
    for (const match of betBody.matches) {
      if (this.balanceSats() < match.amount_sats) {
        // Should be rare — server matched more than we have left
        console.warn(
          `${this.label}: skipping match ${match.pair_id} — balance ${this.balanceSats()} < ${match.amount_sats}`,
        );
        continue;
      }
      const ok = await this.submitForMatch(marketId, match, side);
      if (ok) {
        submittedCount++;
        committedSats += match.amount_sats;
      }
    }

    return {
      orderId: betBody.order_id,
      matches: betBody.matches,
      submittedCount,
      committedSats,
    };
  }

  private async submitForMatch(
    marketId: string,
    match: BetMatch,
    side: "yes" | "no",
  ): Promise<boolean> {
    // Build the P2PK-locked exchange token using exactly enough proofs.
    // createLockedToken now uses marketLocktime (long lock) — the token
    // remains valid through the entire market duration.
    let tokenResult;
    try {
      tokenResult = await createLockedToken(this.wallet, this.proofs, {
        mintUrl: this.mintUrl,
        marketGroupPubkeyYes: match.group_pubkey_yes,
        marketGroupPubkeyNo: match.group_pubkey_no,
        myPubkey: this.identity.pubkey,
        mySide: side,
        counterpartyPubkey: match.counterparty_pubkey,
        amountSats: match.amount_sats,
        exchangeLocktime: match.locktime_exchange,
        marketLocktime: match.locktime_market,
      });
    } catch (err) {
      console.warn(
        `${this.label}: createLockedToken failed for ${match.pair_id}:`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }

    // Replace our pool with exactly what the wallet kept back. The send op
    // produces fresh, valid change proofs; using them directly keeps the
    // bot's local balance view in sync with the wallet's actual state.
    this.proofs = tokenResult.keepProofs;

    const submitRes = await this.post(`/markets/${marketId}/submit-token`, {
      pair_id: match.pair_id,
      cashu_token: tokenResult.token,
      bettor_pubkey: this.identity.pubkey,
    });
    const submitText = await submitRes.text();
    if (submitRes.status !== 200) {
      console.warn(
        `${this.label}: /submit-token failed ${submitRes.status}: ${submitText}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Poll the market for any matched pairs that name this bot but for which
   * we have not yet submitted a P2PK-locked token, and submit them. The
   * matchmaker server only returns matches in the response of the bet that
   * *triggered* the match — earlier bets that sit in the book waiting for a
   * counterparty are never notified. Until the platform grows a push
   * channel (Nostr event / SSE / WebSocket), bots must poll.
   *
   * The side per-pair comes from the server (which knows whether this
   * pubkey was the yes_pubkey or no_pubkey on each pair) — not from the
   * caller. A bot that bet YES in round 1 and NO in round 2 on the same
   * market will have pending pairs of *different* sides; using the
   * caller-supplied side for all of them produces tokens with the wrong
   * P2PK lock conditions.
   *
   * Tracks which pair_ids have already been processed to avoid re-submitting.
   */
  async submitPendingMatches(
    marketId: string,
    _legacySideHint?: "yes" | "no",
  ): Promise<number> {
    const detailRes = await fetch(
      `${this.serverUrl}/markets/${marketId}?pubkey=${this.identity.pubkey}`,
    );
    if (!detailRes.ok) {
      const errText = await detailRes.text();
      console.warn(
        `${this.label}: market detail failed ${detailRes.status} for ${marketId}: ${errText}`,
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
    if (!detail.user_pairs) return 0;

    const marketLocktime = detail.resolution_deadline + 3600;
    let submitted = 0;
    for (const userPair of detail.user_pairs) {
      if (this.processedPairs.has(userPair.pair_id)) continue;
      if (userPair.status !== "pending") continue; // already locked or settled

      const ok = await this.submitForMatch(marketId, {
        pair_id: userPair.pair_id,
        counterparty_pubkey: userPair.counterparty_pubkey,
        group_pubkey_yes: detail.group_pubkey_yes,
        group_pubkey_no: detail.group_pubkey_no,
        locktime_exchange: Math.floor(Date.now() / 1000) + 600,
        locktime_market: marketLocktime,
        amount_sats: userPair.amount_sats,
      }, userPair.side);
      if (ok) submitted++;
      this.processedPairs.add(userPair.pair_id);
    }
    void _legacySideHint;
    return submitted;
  }

  private readonly processedPairs = new Set<string>();

  private async post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.serverUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

export function generateBotIdentity(): BotIdentity {
  const sk = generateSecretKey();
  return { secretHex: bytesToHex(sk), pubkey: getPublicKey(sk) };
}

