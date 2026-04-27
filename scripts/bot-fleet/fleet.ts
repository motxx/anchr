/**
 * BotFleet — orchestrates a population of MarketMakerBots over a seeded set
 * of Polymarket-style markets.
 *
 * - YES-leaning and NO-leaning bots, mixed in a configurable ratio.
 * - Each bot owns a real Cashu wallet, funded once via the regtest faucet.
 * - For each seeded market, every bot decides side ∈ {yes, no} according to
 *   its own bias × the market's `yes_bias`, picks a bet size around the
 *   market's `typical_bet_sats`, and places one bet.
 * - After everyone bets, a settlement pass calls `submitPendingMatches` on
 *   each bot to lock pairs whose match notification went to the
 *   *triggering* bet only (the matchmaker doesn't push to early bettors).
 */

import { MarketMakerBot } from "./bot.ts";
import type { SeedMarket } from "./markets.ts";

export interface SeededMarket {
  /** Server-assigned market id. */
  id: string;
  seed: SeedMarket;
}

export interface FleetConfig {
  serverUrl: string;
  mintUrl: string;
  /** How many YES-leaning bots to spin up. */
  yesLeaningBots: number;
  /** How many NO-leaning bots to spin up. */
  noLeaningBots: number;
  /** Initial sats per bot. Should comfortably cover sum of bets across all markets. */
  fundingSatsPerBot: number;
  /** Multiplier on each market's typical_bet_sats. 1.0 = exactly typical. */
  betSizeFactor?: number;
  /** Deterministic RNG seed for reproducibility. */
  rngSeed?: number;
}

export interface FleetResult {
  bots: MarketMakerBot[];
  markets: SeededMarket[];
  totalBets: number;
  totalCommittedSats: number;
  pairsLocked: number;
}

/** Mulberry32 — small deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BotProfile {
  bot: MarketMakerBot;
  /** Probability this bot picks YES on a given market regardless of market bias. */
  ownYesBias: number;
}

/** Seed all markets in `seedSet` against the running server. */
export async function seedMarkets(
  serverUrl: string,
  seedSet: readonly SeedMarket[],
): Promise<SeededMarket[]> {
  const out: SeededMarket[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const seed of seedSet) {
    const deadline = now + seed.resolution_in_days * 86400;
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/markets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: seed.title,
        description: seed.description,
        category: seed.category === "science" || seed.category === "culture" ? "custom" : seed.category,
        resolution_url: seed.resolution_url,
        resolution_deadline: deadline,
        resolution_condition: {
          ...seed.resolution_condition,
          target_url: seed.resolution_url,
          description: seed.title,
        },
        min_bet_sats: 100,
      }),
    });
    if (res.status !== 201) {
      const errText = await res.text();
      throw new Error(`seed market ${seed.slug} failed: ${res.status} ${errText}`);
    }
    const market = await res.json() as { id: string };
    out.push({ id: market.id, seed });
  }
  return out;
}

/** Spawn a fleet of funded bots. */
export async function fundFleet(config: FleetConfig): Promise<BotProfile[]> {
  const profiles: BotProfile[] = [];
  // Fund bots sequentially — the regtest mint rate-limits parallel mints.
  for (let i = 0; i < config.yesLeaningBots; i++) {
    const bot = await MarketMakerBot.fund({
      serverUrl: config.serverUrl,
      mintUrl: config.mintUrl,
      initialFundingSats: config.fundingSatsPerBot,
      label: `yes-bot-${i}`,
    });
    profiles.push({ bot, ownYesBias: 0.7 });
  }
  for (let i = 0; i < config.noLeaningBots; i++) {
    const bot = await MarketMakerBot.fund({
      serverUrl: config.serverUrl,
      mintUrl: config.mintUrl,
      initialFundingSats: config.fundingSatsPerBot,
      label: `no-bot-${i}`,
    });
    profiles.push({ bot, ownYesBias: 0.3 });
  }
  return profiles;
}

/** Place one round of bets across all markets, then settle pending matches. */
export async function runOneRound(
  profiles: BotProfile[],
  markets: SeededMarket[],
  opts: { rngSeed?: number; betSizeFactor?: number } = {},
): Promise<FleetResult> {
  const r = rng(opts.rngSeed ?? Math.floor(Date.now() % 0xffffffff));
  const betSizeFactor = opts.betSizeFactor ?? 1;

  let totalBets = 0;
  let totalCommittedSats = 0;
  // Track which (bot, market, side) tuples we already placed so settlement
  // pass knows which side to use.
  const sideByBotMarket = new Map<string, "yes" | "no">();

  for (const market of markets) {
    for (const profile of profiles) {
      const blendedYesProb = (market.seed.yes_bias + profile.ownYesBias) / 2;
      const side: "yes" | "no" = r() < blendedYesProb ? "yes" : "no";
      // Bet size = typical * (0.5..1.5) * factor, rounded to multiples of 100.
      const betSats = Math.max(
        100,
        Math.round((market.seed.typical_bet_sats * (0.5 + r()) * betSizeFactor) / 100) * 100,
      );
      if (profile.bot.balanceSats() < betSats) {
        // Skip bots that ran out of liquidity in this round.
        continue;
      }
      try {
        const result = await profile.bot.placeBet(market.id, side, betSats);
        totalBets++;
        totalCommittedSats += result.committedSats;
        sideByBotMarket.set(`${profile.bot.identity.pubkey}:${market.id}`, side);
      } catch (err) {
        console.warn(
          `[fleet] ${profile.bot.label} failed to bet on ${market.seed.slug}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Settlement pass — early bettors get notified via polling.
  let pairsLocked = 0;
  for (const market of markets) {
    for (const profile of profiles) {
      const side = sideByBotMarket.get(`${profile.bot.identity.pubkey}:${market.id}`);
      if (!side) continue;
      const submitted = await profile.bot.submitPendingMatches(market.id, side);
      pairsLocked += submitted;
    }
  }

  return {
    bots: profiles.map((p) => p.bot),
    markets,
    totalBets,
    totalCommittedSats,
    pairsLocked,
  };
}
