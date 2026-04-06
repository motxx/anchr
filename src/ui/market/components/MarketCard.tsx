import React from "react";
import type { Market } from "../mock-data";
import { cn } from "../../lib/utils";

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

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:border-primary/40 hover:bg-card/80 hover:shadow-[0_0_24px_-6px_hsl(270_80%_60%/0.15)] group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{categoryIcon(market.category)}</span>
          <span className="uppercase tracking-wider">{market.category}</span>
        </div>
        <div className={cn(
          "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
          isOpen && "bg-primary/15 text-primary",
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
      <h3 className="text-[15px] font-semibold leading-snug text-foreground mb-4 group-hover:text-primary/90 transition-colors">
        {market.title}
      </h3>

      {/* Probability bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-yes font-mono text-lg font-semibold">{yesPercent}%</span>
            <span className="text-xs text-muted-foreground">Yes</span>
          </div>
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

      {/* Footer stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="font-mono">{formatSats(market.volume_sats)} sats</span>
        <span className="text-border">|</span>
        <span>{market.num_bettors} bettors</span>
        <span className="text-border">|</span>
        <span>Pool: {formatSats(total)} sats</span>
      </div>
    </button>
  );
}
