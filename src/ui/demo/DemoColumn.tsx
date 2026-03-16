import React, { useEffect, useRef } from "react";
import type { DemoEvent } from "./DemoApp";

interface Props {
  actor: string;
  label: string;
  color: string;
  icon: string;
  events: DemoEvent[];
}

const TYPE_ICON: Record<string, string> = {
  step: "\u25B6",
  ok: "\u2713",
  info: "\u2022",
  warn: "\u26A0",
  fail: "\u2717",
};

const TYPE_COLOR: Record<string, string> = {
  step: "text-foreground font-semibold",
  ok: "text-emerald-400",
  info: "text-muted-foreground",
  warn: "text-amber-400",
  fail: "text-red-400",
};

export function DemoColumn({ actor, label, color, icon, events }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const headerBg: Record<string, string> = {
    blue: "bg-blue-950 border-blue-400/30",
    emerald: "bg-emerald-950 border-emerald-400/30",
    purple: "bg-purple-950 border-purple-400/30",
  };

  const iconBg: Record<string, string> = {
    blue: "bg-blue-400",
    emerald: "bg-emerald-400",
    purple: "bg-purple-400",
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Column header */}
      <div
        className={`px-4 py-3 border-b flex items-center gap-3 ${headerBg[color] ?? ""}`}
      >
        <span
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-background ${iconBg[color] ?? "bg-muted"}`}
        >
          {icon}
        </span>
        <span className="font-semibold text-sm tracking-wide">{label}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {events.filter((e) => e.actor === actor).length} events
        </span>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {events.map((ev, i) => (
          <div
            key={`${ev.step}-${ev.type}-${i}`}
            className={`animate-slide-in text-[13px] leading-relaxed flex gap-2 ${
              ev.actor === "system" ? "opacity-60 italic" : ""
            }`}
          >
            <span className={`shrink-0 w-4 text-center ${TYPE_COLOR[ev.type] ?? ""}`}>
              {TYPE_ICON[ev.type] ?? ""}
            </span>
            <div className="min-w-0">
              {ev.type === "step" && ev.message !== "__done__" && (
                <span className="text-muted-foreground text-[11px] mr-1.5">
                  [{ev.step}]
                </span>
              )}
              <span className={TYPE_COLOR[ev.type] ?? ""}>
                {ev.message === "__done__" ? "Done" : ev.message}
              </span>
              {ev.data && (
                <div className="mt-0.5 text-[11px] text-muted-foreground font-mono break-all">
                  {Object.entries(ev.data).map(([k, v]) => (
                    <div key={k}>
                      {k}: {v}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
