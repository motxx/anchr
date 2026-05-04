import React, { useEffect, useRef, useState } from "react";

interface LogEntry {
  service: string;
  message: string;
  ts: number;
}

export function DashboardLogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/logs/stream");
    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data) as LogEntry;
        setLogs((prev) => [...prev.slice(-200), entry]);
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 h-full flex flex-col">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Server Logs
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[11px] space-y-0.5 min-h-0">
        {logs.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic font-sans">
            Connecting to log stream...
          </p>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className="flex gap-2 leading-tight">
              <span className={`shrink-0 ${serviceColor(entry.service)}`}>
                [{entry.service}]
              </span>
              <span className="text-muted-foreground break-all">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function serviceColor(svc: string): string {
  if (svc.includes("cashu") || svc.includes("wallet")) return "text-amber-400";
  if (svc.includes("oracle")) return "text-purple-400";
  if (svc.includes("relay") || svc.includes("nostr")) return "text-blue-400";
  return "text-muted-foreground";
}
