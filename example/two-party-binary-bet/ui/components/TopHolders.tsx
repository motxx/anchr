import React from "react";
import type { HolderRow } from "../lib/market-history.ts";
import { cn } from "../lib/utils.ts";

function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return sats.toLocaleString();
}

function truncate(pubkey: string): string {
  if (pubkey.length <= 14) return pubkey;
  return `${pubkey.slice(0, 10)}…${pubkey.slice(-3)}`;
}

interface TopHoldersProps {
  rows: HolderRow[];
  limit?: number;
}

/**
 * Top holders by stake — Polymarket's "Holders" panel analog. One row per
 * pubkey, side badge + sats. Horizontal bar shows relative stake.
 */
export function TopHolders({ rows, limit = 8 }: TopHoldersProps) {
  const visible = rows.slice(0, limit);
  const max = visible.length > 0 ? visible[0].shares_sats : 1;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Top Holders</h2>
        <span className="text-[11px] text-muted-foreground font-mono">
          {visible.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No holders yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((row, i) => {
            const widthPct = Math.max(8, Math.round((row.shares_sats / max) * 100));
            return (
              <li key={`${row.pubkey}-${i}`} className="relative">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-md",
                    row.side === "yes" ? "bg-yes/12" : "bg-no/12",
                  )}
                  style={{ width: `${widthPct}%` }}
                  aria-hidden="true"
                />
                <div className="relative flex items-center justify-between gap-3 px-2 py-1.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[11px] font-mono text-muted-foreground tabular-nums w-4">
                      {i + 1}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        row.side === "yes" ? "bg-yes/18 text-yes" : "bg-no/18 text-no",
                      )}
                    >
                      {row.side}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground truncate">
                      {truncate(row.pubkey)}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-foreground shrink-0">
                    {formatSats(row.shares_sats)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
