import React from "react";
import type { ActivityEvent } from "../lib/market-history.ts";
import { formatRelativeTime } from "../lib/market-history.ts";
import { cn } from "../lib/utils.ts";

function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return sats.toLocaleString();
}

function truncate(pubkey: string): string {
  if (pubkey.length <= 14) return pubkey;
  return `${pubkey.slice(0, 10)}...${pubkey.slice(-3)}`;
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  /** Optional cap; default 8. */
  limit?: number;
}

/**
 * Recent trade feed — the "Activity" panel that anchors both
 * Polymarket and Kalshi market detail pages. Each row: side badge,
 * sats amount, truncated pubkey, relative time.
 */
export function ActivityFeed({ events, limit = 8 }: ActivityFeedProps) {
  const visible = events.slice(0, limit);

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Activity
        </h2>
        <span className="text-[11px] text-muted-foreground font-mono">
          {events.length} recent
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                    e.side === "yes" ? "bg-yes/15 text-yes" : "bg-no/15 text-no",
                  )}
                >
                  {e.side}
                </span>
                <span className="font-mono text-sm text-foreground truncate">
                  {formatSats(e.amount_sats)}
                  <span className="text-muted-foreground"> sats</span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground truncate hidden sm:inline">
                  {truncate(e.pubkey)}
                </span>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                {formatRelativeTime(e.t)} ago
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
