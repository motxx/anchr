import React from "react";
import type { Market } from "../mock-data";

interface StatsBarProps {
  markets: Market[];
}

export function StatsBar({ markets }: StatsBarProps) {
  const openMarkets = markets.filter((m) => m.status === "open").length;
  const totalVolume = markets.reduce((sum, m) => sum + m.volume_sats, 0);
  const totalBettors = markets.reduce((sum, m) => sum + m.num_bettors, 0);

  function formatSats(sats: number): string {
    if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
    if (sats >= 1_000) return `${(sats / 1_000).toFixed(0)}K`;
    return String(sats);
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
      <StatCard label="Active Markets" value={String(openMarkets)} />
      <StatCard label="Total Volume" value={`${formatSats(totalVolume)} sats`} mono />
      <StatCard label="Total Bettors" value={String(totalBettors)} />
      <StatCard label="Avg Pool" value={`${formatSats(Math.floor(totalVolume / markets.length))} sats`} mono />
    </div>
  );
}

function StatCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-lg font-bold text-foreground ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
