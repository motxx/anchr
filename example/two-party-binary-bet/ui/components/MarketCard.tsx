import React, { useMemo } from "react";
import type { Market } from "../mock-data.ts";
import { cn } from "../lib/utils.ts";
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

function categoryIcon(cat: string): string {
  switch (cat) {
    case "crypto": return "₿";
    case "sports": return "⚽";
    case "politics": return "🏛";
    case "economics": return "📊";
    default: return "⚡";
  }
}

interface MarketCardProps {
  market: Market;
  onClick: () => void;
}

export function MarketCard({ market, onClick }: MarketCardProps) {
  const total = market.yes_pool_sats + market.no_pool_sats;
  const yesPercent = total > 0 ? Math.round((market.yes_pool_sats / total) * 100) : 50;
  const noPercent = 100 - yesPercent;
  const isResolved = market.status.startsWith("resolved_");
  const isOpen = market.status === "open";
  const history = useMemo(() => generateHistory(market, 32), [market]);

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card p-4 sm:p-5 transition-colors hover:border-foreground/30 group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{categoryIcon(market.category)}</span>
          <span className="uppercase tracking-wider">{market.category}</span>
        </div>
        <div className={cn(
          "shrink-0 rounded-md px-2 py-0.5 text-xs font-mono font-medium",
          isOpen && "bg-foreground/8 text-foreground/70",
          market.status === "resolved_yes" && "bg-yes/15 text-yes",
          market.status === "resolved_no" && "bg-no/15 text-no",
          market.status === "closed" && "bg-muted text-muted-foreground",
          market.status === "expired" && "bg-muted text-muted-foreground",
        )}>
          {isResolved ? (market.status === "resolved_yes" ? "Resolved YES" : "Resolved NO") :
           market.status === "open" ? formatTimeLeft(market.resolution_deadline) :
           market.status.charAt(0).toUpperCase() + market.status.slice(1)}
        </div>
      </div>

      {/* Title */}
      <h3 className="text-[15px] font-semibold leading-snug text-foreground mb-4 transition-colors">
        {market.title}
      </h3>

      {/* Probability bar + sparkline */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-yes font-mono text-lg font-semibold">{yesPercent}%</span>
            <span className="text-xs text-muted-foreground">Yes</span>
          </div>
          <Sparkline data={history} width={96} height={22} className="opacity-90" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">No</span>
            <span className="text-no font-mono text-lg font-semibold">{noPercent}%</span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden flex">
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

      {/* Footer — Polymarket-style 3-metric */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <FooterMetric label="Vol" value={`${formatSats(market.volume_sats)} sats`} />
        <FooterMetric label="24h" value={`${formatSats(volume24h(market))} sats`} />
        <FooterMetric label="Bettors" value={String(market.num_bettors)} />
      </div>
    </button>
  );
}

function FooterMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</div>
      <div className="font-mono text-xs font-semibold text-foreground truncate">{value}</div>
    </div>
  );
}
