import React, { useMemo } from "react";
import type { Market } from "../mock-data.ts";
import { generateHistory, volume24h } from "../lib/market-history.ts";
import { Sparkline } from "./Sparkline.tsx";

function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(0)}K`;
  return String(sats);
}

function formatTimeLeft(deadline: number): string {
  const diff = deadline - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 30) return `${Math.floor(days / 30)}mo`;
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % 3600) / 60);
  return `${hours}h ${mins}m`;
}

interface FeaturedMarketProps {
  market: Market;
  onClick: () => void;
}

/**
 * Hero card pinned at the top of the homepage. Larger than a regular
 * MarketCard, with a 60-point sparkline and the headline % rendered very
 * large — Polymarket's "featured" treatment.
 */
export function FeaturedMarket({ market, onClick }: FeaturedMarketProps) {
  const total = market.yes_pool_sats + market.no_pool_sats;
  const yesPercent = total > 0 ? Math.round((market.yes_pool_sats / total) * 100) : 50;
  const noPercent = 100 - yesPercent;
  const history = useMemo(() => generateHistory(market, 80), [market]);
  const v24 = volume24h(market);

  return (
    <button
      onClick={onClick}
      className="block w-full text-left rounded-lg border border-border bg-card p-5 sm:p-6 transition-colors hover:border-foreground/30 group mb-6"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="rounded bg-foreground/8 text-foreground/80 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
          Featured
        </span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          {market.category}
        </span>
        <span className="text-xs text-muted-foreground ml-auto font-mono">
          {formatTimeLeft(market.resolution_deadline)} left
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-end">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold leading-tight text-foreground mb-4 transition-colors">
            {market.title}
          </h2>

          <div className="flex items-baseline gap-6 mb-2">
            <div>
              <span className="font-mono text-5xl font-bold text-yes leading-none">
                {yesPercent}
              </span>
              <span className="font-mono text-2xl text-yes/70 leading-none">%</span>
              <span className="text-sm text-muted-foreground ml-2">Yes</span>
            </div>
            <div>
              <span className="font-mono text-2xl font-semibold text-no/70 leading-none">
                {noPercent}%
              </span>
              <span className="text-sm text-muted-foreground ml-1">No</span>
            </div>
          </div>

          <div className="h-2 rounded-full bg-muted overflow-hidden flex max-w-md">
            <div
              className="h-full bg-yes rounded-l-full transition-all duration-500"
              style={{ width: `${yesPercent}%` }}
            />
            <div
              className="h-full bg-no rounded-r-full transition-all duration-500"
              style={{ width: `${noPercent}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <Sparkline data={history} width={200} height={64} />
          <div className="flex items-center gap-4 font-mono text-xs">
            <Stat label="Vol" value={`${formatSats(market.volume_sats)} sats`} />
            <Stat label="24h" value={`${formatSats(v24)} sats`} />
            <Stat label="Bettors" value={String(market.num_bettors)} />
          </div>
        </div>
      </div>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
