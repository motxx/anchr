import type { Market } from "../mock-data.ts";

export interface HistoryPoint {
  /** Unix timestamp (seconds). */
  t: number;
  /** YES probability in 0..1. */
  yes: number;
}

export type ActivitySide = "yes" | "no";

export interface ActivityEvent {
  id: string;
  side: ActivitySide;
  amount_sats: number;
  pubkey: string;
  /** Unix timestamp (seconds). */
  t: number;
}

/** Mulberry32 — deterministic PRNG seeded from the market id. */
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

function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Generate a deterministic probability time-series ending at the current
 * market YES probability. Used while the matchmaker has no on-chain price
 * history feed — the shape is plausible and stable per market id.
 */
export function generateHistory(market: Market, points = 48): HistoryPoint[] {
  const total = market.yes_pool_sats + market.no_pool_sats;
  const target = total > 0 ? market.yes_pool_sats / total : 0.5;
  const rand = rng(hashId(market.id));

  const start = market.created_at;
  const end = Math.min(market.resolution_deadline, Math.floor(Date.now() / 1000));
  const span = Math.max(end - start, 3600);
  const step = span / (points - 1);

  // Random walk with drift toward target.
  const series: HistoryPoint[] = [];
  let yes = 0.5 + (rand() - 0.5) * 0.2;
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    const drift = (target - yes) * 0.18;
    const noise = (rand() - 0.5) * 0.12 * (1 - progress * 0.6);
    yes = Math.min(0.98, Math.max(0.02, yes + drift + noise));
    if (i === points - 1) yes = target;
    series.push({ t: Math.round(start + step * i), yes });
  }
  return series;
}

const SAMPLE_PUBKEYS = [
  "npub1alice...4f2",
  "npub1bob...91d",
  "npub1carol...3a7",
  "npub1dave...e8c",
  "npub1eve...51b",
  "npub1frank...62a",
  "npub1grace...7d9",
];

/**
 * Generate a deterministic recent-activity feed. Newest first. Counts and
 * amounts roughly track market.volume_sats / market.num_bettors.
 */
export function generateActivity(market: Market, count = 12): ActivityEvent[] {
  const rand = rng(hashId(market.id) ^ 0x9E3779B9);
  const total = market.yes_pool_sats + market.no_pool_sats;
  const yesBias = total > 0 ? market.yes_pool_sats / total : 0.5;
  const avgBet = market.num_bettors > 0
    ? Math.max(market.min_bet_sats, Math.floor(market.volume_sats / market.num_bettors))
    : Math.max(market.min_bet_sats, 1000);

  const now = Math.floor(Date.now() / 1000);
  const events: ActivityEvent[] = [];
  for (let i = 0; i < count; i++) {
    const side: ActivitySide = rand() < yesBias ? "yes" : "no";
    const sizeMul = 0.3 + rand() * 2.4;
    const amount = Math.max(market.min_bet_sats, Math.round(avgBet * sizeMul));
    const ageSec = Math.round((i + rand()) * 360 + rand() * 240);
    events.push({
      id: `${market.id}-act-${i}`,
      side,
      amount_sats: amount,
      pubkey: SAMPLE_PUBKEYS[Math.floor(rand() * SAMPLE_PUBKEYS.length)],
      t: now - ageSec,
    });
  }
  return events;
}

export function formatRelativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
