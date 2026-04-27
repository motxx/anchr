import React, { useMemo } from "react";
import type { HistoryPoint } from "../lib/market-history.ts";

interface SparklineProps {
  data: HistoryPoint[];
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Minimal SVG sparkline of YES probability over time. No axes, no grid —
 * a one-glance shape indicator that lives inside market cards. Color is
 * decided by net direction: green when YES trended up, red when down.
 */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  className,
}: SparklineProps) {
  const { path, fill, color } = useMemo(() => {
    if (data.length < 2) {
      return { path: "", fill: "", color: "hsl(var(--muted-foreground))" };
    }
    const xs = data.map((_, i) => (i / (data.length - 1)) * width);
    const ys = data.map((p) => height - p.yes * height);
    const direction = data[data.length - 1].yes - data[0].yes;
    const color = direction >= 0 ? "hsl(var(--yes))" : "hsl(var(--no))";

    const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const area = `${line} L${width.toFixed(1)},${height} L0,${height} Z`;
    return { path: line, fill: area, color };
  }, [data, width, height]);

  if (!path) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path d={fill} fill={color} fillOpacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
