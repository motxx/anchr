import {
  ChevronDown,
  ChevronRight,
  Terminal,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { cn } from "./lib/utils";

interface LogEntry {
  service: string;
  message: string;
  ts: number;
}

const SERVICE_COLORS: Record<string, string> = {
  relay: "text-purple-400",
  blossom: "text-pink-400",
  "tlsn-verifier": "text-blue-400",
  bitcoind: "text-orange-400",
  "lnd-mint": "text-yellow-400",
  "lnd-user": "text-lime-400",
  "cashu-mint": "text-green-400",
  anchr: "text-cyan-400",
  docker: "text-zinc-400",
  system: "text-red-400",
};

const ALL_SERVICES = Object.keys(SERVICE_COLORS);

function ServiceFilterChips({
  activeServices,
  hidden,
  counts,
  logsCount,
  onToggle,
  onClear,
}: {
  activeServices: string[];
  hidden: Set<string>;
  counts: Record<string, number>;
  logsCount: number;
  onToggle: (svc: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="px-4 py-2 flex items-center gap-1.5 flex-wrap border-b border-border/50">
      {(activeServices.length > 0 ? activeServices : ALL_SERVICES).map((svc) => (
        <button
          key={svc}
          type="button"
          onClick={() => onToggle(svc)}
          className={cn(
            "text-[10px] font-mono px-1.5 py-0.5 rounded transition-opacity",
            hidden.has(svc) ? "opacity-30 bg-black/20" : "opacity-100 bg-black/40",
            SERVICE_COLORS[svc] || "text-zinc-400",
          )}
        >
          {svc}
          {counts[svc] ? ` (${counts[svc]})` : ""}
        </button>
      ))}
      {logsCount > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function LogOutput({
  filtered,
  totalCount,
  scrollRef,
  onScroll,
}: {
  filtered: LogEntry[];
  totalCount: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-64 overflow-y-auto overflow-x-hidden font-mono text-[11px] leading-relaxed px-4 py-2"
    >
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground/50 text-xs">
          {totalCount === 0 ? "Connecting to log stream..." : "All services filtered"}
        </div>
      ) : (
        filtered.map((entry, i) => (
          <div key={i} className="flex gap-2 hover:bg-white/[0.02] py-px">
            <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0 w-16 text-right">
              {new Date(entry.ts).toLocaleTimeString("en-GB", { hour12: false })}
            </span>
            <span
              className={cn(
                "shrink-0 w-24 text-right truncate font-semibold",
                SERVICE_COLORS[entry.service] || "text-zinc-400",
              )}
            >
              {entry.service}
            </span>
            <span className="text-foreground/80 break-all">{entry.message}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function LogsPanel() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!open) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    const apiBase = typeof window !== "undefined" ? window.location.origin : "";
    const es = new EventSource(`${apiBase}/logs/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data) as LogEntry;
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {};

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  function toggleService(svc: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(svc) ? next.delete(svc) : next.add(svc);
      return next;
    });
  }

  const filtered = hidden.size > 0 ? logs.filter((l) => !hidden.has(l.service)) : logs;

  const counts: Record<string, number> = {};
  for (const l of logs) counts[l.service] = (counts[l.service] || 0) + 1;
  const activeServices = Object.keys(counts).sort();

  return (
    <div className="border-t border-border bg-black/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground">Container Logs</span>
          {logs.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60">{logs.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!open && activeServices.length > 0 && (
            <div className="flex items-center gap-1">
              {activeServices.slice(0, 5).map((svc) => (
                <span
                  key={svc}
                  className={cn("text-[9px] font-mono px-1 py-0.5 rounded bg-black/40", SERVICE_COLORS[svc] || "text-zinc-400")}
                >
                  {svc}
                </span>
              ))}
              {activeServices.length > 5 && (
                <span className="text-[9px] text-muted-foreground">+{activeServices.length - 5}</span>
              )}
            </div>
          )}
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-border">
          <ServiceFilterChips
            activeServices={activeServices}
            hidden={hidden}
            counts={counts}
            logsCount={logs.length}
            onToggle={toggleService}
            onClear={() => { setLogs([]); setHidden(new Set()); }}
          />
          <LogOutput
            filtered={filtered}
            totalCount={logs.length}
            scrollRef={scrollRef}
            onScroll={handleScroll}
          />
          {!autoScroll && (
            <div className="px-4 py-1 border-t border-border/50">
              <button
                type="button"
                onClick={() => {
                  setAutoScroll(true);
                  scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                }}
                className="text-[10px] text-blue-400 hover:text-blue-300"
              >
                {"\u2193"} Scroll to bottom
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
