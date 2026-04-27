import React, { useMemo, useState } from "react";
import type { HistoryPoint } from "../lib/market-history.ts";
import { cn } from "../lib/utils.ts";

interface PriceChartProps {
  data: HistoryPoint[];
  /** Optional height override (default 220px). */
  height?: number;
}

const RANGES = [
  { label: "1H", seconds: 3600 },
  { label: "1D", seconds: 86400 },
  { label: "1W", seconds: 86400 * 7 },
  { label: "1M", seconds: 86400 * 30 },
  { label: "ALL", seconds: Number.POSITIVE_INFINITY },
] as const;

type RangeKey = (typeof RANGES)[number]["label"];

/**
 * Probability-over-time chart for the market detail view. Modeled after
 * the YES/NO curve that anchors every Polymarket and Kalshi market page —
 * a single line, light grid, range selector, hover crosshair.
 */
export function PriceChart({ data, height = 220 }: PriceChartProps) {
  const [range, setRange] = useState<RangeKey>("ALL");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (data.length === 0) return data;
    const now = data[data.length - 1].t;
    const cutoff = RANGES.find((r) => r.label === range)!.seconds;
    if (!Number.isFinite(cutoff)) return data;
    const min = now - cutoff;
    const slice = data.filter((p) => p.t >= min);
    return slice.length >= 2 ? slice : data.slice(-2);
  }, [data, range]);

  const width = 800;
  const padX = 8;
  const padTop = 8;
  const padBottom = 22;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const { line, area, points, latest, change } = useMemo(() => {
    if (filtered.length < 2) {
      return { line: "", area: "", points: [], latest: 0, change: 0 };
    }
    const xs = filtered.map((_, i) => padX + (i / (filtered.length - 1)) * innerW);
    const ys = filtered.map((p) => padTop + (1 - p.yes) * innerH);
    const segs: string[] = [];
    for (let i = 0; i < xs.length; i++) {
      segs.push(`${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`);
    }
    const linePath = segs.join(" ");
    const areaPath = `${linePath} L${xs[xs.length - 1].toFixed(1)},${(padTop + innerH).toFixed(1)} L${xs[0].toFixed(1)},${(padTop + innerH).toFixed(1)} Z`;
    const pts = xs.map((x, i) => ({ x, y: ys[i] }));
    const latest = filtered[filtered.length - 1].yes;
    const change = latest - filtered[0].yes;
    return { line: linePath, area: areaPath, points: pts, latest, change };
  }, [filtered, innerH, innerW]);

  const trendingUp = change >= 0;
  const lineColor = trendingUp ? "hsl(var(--yes))" : "hsl(var(--no))";
  const yesPercent = Math.round(latest * 100);
  const changePct = Math.round(change * 100);

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (filtered.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.min(filtered.length - 1, Math.max(0, Math.round(ratio * (filtered.length - 1))));
    setHoverIdx(idx);
  }

  if (filtered.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        Not enough history to chart yet.
      </div>
    );
  }

  const hover = hoverIdx !== null ? filtered[hoverIdx] : null;
  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            YES Probability
          </div>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold text-foreground">{yesPercent}%</span>
            <span className={cn("font-mono text-sm font-medium", trendingUp ? "text-yes" : "text-no")}>
              {trendingUp ? "+" : ""}{changePct}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.label)}
              className={cn(
                "h-7 px-2.5 rounded-md text-xs font-mono font-medium transition-colors",
                range === r.label
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          width="100%"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Horizontal grid: 0 / 25 / 50 / 75 / 100 */}
          {[0, 0.25, 0.5, 0.75, 1].map((p) => {
            const y = padTop + (1 - p) * innerH;
            const dashed = p !== 0.5;
            return (
              <g key={p}>
                <line
                  x1={padX}
                  x2={width - padX}
                  y1={y}
                  y2={y}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                  strokeDasharray={dashed ? "2 4" : undefined}
                  opacity={p === 0.5 ? 0.8 : 0.5}
                />
                <text
                  x={width - padX - 4}
                  y={y - 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  style={{ fontSize: 10, fontFamily: "Geist Mono, monospace" }}
                >
                  {Math.round(p * 100)}%
                </text>
              </g>
            );
          })}

          {/* Filled area + line */}
          <path d={area} fill={lineColor} fillOpacity={0.10} />
          <path
            d={line}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Time axis labels: first / mid / last */}
          {[0, Math.floor(filtered.length / 2), filtered.length - 1].map((i) => (
            <text
              key={i}
              x={points[i].x}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === filtered.length - 1 ? "end" : "middle"}
              className="fill-muted-foreground"
              style={{ fontSize: 10, fontFamily: "Geist Mono, monospace" }}
            >
              {dateFmt.format(new Date(filtered[i].t * 1000))}
            </text>
          ))}

          {/* Hover crosshair */}
          {hoverPoint && hover && (
            <g>
              <line
                x1={hoverPoint.x}
                x2={hoverPoint.x}
                y1={padTop}
                y2={padTop + innerH}
                stroke="hsl(var(--primary))"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.6}
              />
              <circle
                cx={hoverPoint.x}
                cy={hoverPoint.y}
                r={4}
                fill={lineColor}
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {hover && hoverPoint && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]"
            style={{
              left: `${(hoverPoint.x / width) * 100}%`,
              top: `${(hoverPoint.y / height) * 100}%`,
              marginTop: -6,
            }}
          >
            <div className="font-mono font-semibold text-foreground">
              {Math.round(hover.yes * 100)}%
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {dateFmt.format(new Date(hover.t * 1000))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
