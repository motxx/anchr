import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api-config";

// ---- Constants ----

const WORKER_PUBKEY = "worker_ui_placeholder_pubkey";
const REQUESTER_PUBKEY = "requester_demo";

// ---- Types ----

interface BalanceData {
  role: string;
  pubkey: string;
  balance_sats: number;
  pending_sats: number;
  mint_url: string | null;
}

interface QuerySummary {
  id: string;
  status: string;
  description: string;
  bounty: { amount_sats: number } | null;
  htlc: {
    hash: string;
    oracle_pubkey: string;
    worker_pubkey: string | null;
    locktime: number;
    verified_escrow_sats: number | null;
  } | null;
  payment_status?: string;
  verification?: {
    passed: boolean;
    checks: string[];
    failures: string[];
  };
  created_at?: number;
  submitted_at?: number;
  expires_at: number;
}

interface LogEntry {
  service: string;
  message: string;
  ts: number;
}

interface ActivityEvent {
  time: number;
  actor: "requester" | "worker" | "oracle" | "system";
  message: string;
  detail?: string;
  type: "info" | "success" | "warning" | "error";
}

// ---- Flow Steps ----

interface FlowStep {
  label: string;
  description: string;
  actor: "requester" | "worker" | "oracle" | "system";
}

const FLOW_STEPS: FlowStep[] = [
  { label: "Create Query", description: "Requester posts a bounty query", actor: "requester" },
  { label: "Worker Accepts", description: "Worker picks up the job", actor: "worker" },
  { label: "Submit Proof", description: "Worker submits photo/TLSNotary proof", actor: "worker" },
  { label: "Verification", description: "Oracle verifies the proof", actor: "oracle" },
  { label: "Settlement", description: "BTC transferred to worker", actor: "system" },
];

function deriveCurrentStep(queries: QuerySummary[]): number {
  if (queries.length === 0) return -1;
  const latest = queries[0]; // sorted by created_at DESC
  switch (latest.status) {
    case "awaiting_quotes": return 0;
    case "worker_selected":
    case "processing": return 1;
    case "verifying": return 3;
    case "approved": return 4;
    case "rejected": return 4;
    default: return -1;
  }
}

// ---- Activity tracker (diff-based) ----

function useActivityTracker(queries: QuerySummary[]): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const prevRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const prev = prevRef.current;
    const next = new Map<string, string>();
    const newEvents: ActivityEvent[] = [];

    for (const q of queries) {
      next.set(q.id, q.status);
      const prevStatus = prev.get(q.id);

      if (!prevStatus) {
        newEvents.push({
          time: Date.now(),
          actor: "requester",
          message: `Query created: ${q.description}`,
          detail: q.bounty ? `Bounty: ${q.bounty.amount_sats} sats` : undefined,
          type: "info",
        });
      } else if (prevStatus !== q.status) {
        const transitions: Record<string, ActivityEvent> = {
          processing: {
            time: Date.now(), actor: "worker",
            message: `Worker accepted query`, type: "info",
          },
          verifying: {
            time: Date.now(), actor: "worker",
            message: `Proof submitted, verifying...`, type: "info",
          },
          approved: {
            time: Date.now(), actor: "oracle",
            message: `Verification passed`,
            detail: q.bounty ? `${q.bounty.amount_sats} sats released to worker` : undefined,
            type: "success",
          },
          rejected: {
            time: Date.now(), actor: "oracle",
            message: `Verification failed`,
            detail: q.bounty ? `${q.bounty.amount_sats} sats refunded to requester` : undefined,
            type: "error",
          },
        };
        const evt = transitions[q.status];
        if (evt) newEvents.push(evt);
      }
    }

    if (newEvents.length > 0) {
      setEvents((prev) => [...prev, ...newEvents].slice(-50));
    }
    prevRef.current = next;
  }, [queries]);

  return events;
}

// ---- Components ----

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1">
      {FLOW_STEPS.map((step, i) => {
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        const actorColor: Record<string, string> = {
          requester: "bg-blue-400",
          worker: "bg-emerald-400",
          oracle: "bg-purple-400",
          system: "bg-amber-400",
        };

        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div className={`h-px flex-1 max-w-8 ${isDone ? "bg-emerald-400/50" : "bg-border"}`} />
            )}
            <div className="flex flex-col items-center gap-1 min-w-0">
              <div
                className={`
                  w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold
                  transition-all duration-300
                  ${isDone ? "bg-emerald-400/20 text-emerald-400 ring-1 ring-emerald-400/30" : ""}
                  ${isActive ? `${actorColor[step.actor]} text-background ring-2 ring-offset-1 ring-offset-background ring-white/20 scale-110` : ""}
                  ${!isDone && !isActive ? "bg-muted text-muted-foreground" : ""}
                `}
              >
                {isDone ? "\u2713" : i + 1}
              </div>
              <span className={`text-[9px] text-center leading-tight max-w-16 ${isActive ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function BalancePanel({
  role,
  label,
  color,
  balance,
  isLoading,
}: {
  role: string;
  label: string;
  color: string;
  balance: BalanceData | undefined;
  isLoading: boolean;
}) {
  const colorMap: Record<string, { text: string; bg: string; border: string }> = {
    blue: { text: "text-blue-400", bg: "bg-blue-950/30", border: "border-blue-400/20" },
    emerald: { text: "text-emerald-400", bg: "bg-emerald-950/30", border: "border-emerald-400/20" },
  };
  const c = colorMap[color] ?? colorMap.blue;

  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        {balance?.mint_url && (
          <span className="text-[9px] text-emerald-500/60">mint-verified</span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${c.text} tabular-nums`}>
          {isLoading ? "..." : (balance?.balance_sats ?? 0)}
        </span>
        <span className="text-xs text-muted-foreground">sats</span>
      </div>
      {balance?.pending_sats ? (
        <div className="mt-1 text-[11px] text-amber-400/70">
          {balance.pending_sats} sats in escrow
        </div>
      ) : null}
    </div>
  );
}

function QueryPanel({ queries, label, color }: { queries: QuerySummary[]; label: string; color: string }) {
  const colorMap: Record<string, { border: string; bg: string }> = {
    blue: { border: "border-blue-400/20", bg: "bg-blue-950/20" },
    emerald: { border: "border-emerald-400/20", bg: "bg-emerald-950/20" },
  };
  const c = colorMap[color] ?? colorMap.blue;

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string }> = {
      awaiting_quotes: { bg: "bg-blue-950", text: "text-blue-400" },
      processing: { bg: "bg-amber-950", text: "text-amber-400" },
      verifying: { bg: "bg-purple-950", text: "text-purple-400" },
      approved: { bg: "bg-emerald-950", text: "text-emerald-400" },
      rejected: { bg: "bg-red-950", text: "text-red-400" },
    };
    const s = map[status] ?? { bg: "bg-muted", text: "text-muted-foreground" };
    return (
      <span className={`${s.bg} ${s.text} text-[10px] font-semibold px-1.5 py-0.5 rounded`}>
        {status}
      </span>
    );
  };

  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        {label} Queries
      </div>
      {queries.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 italic">No queries yet</p>
      ) : (
        <div className="space-y-2">
          {queries.slice(0, 5).map((q) => (
            <div key={q.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-foreground truncate">{q.description}</p>
                {q.bounty && (
                  <span className="text-[10px] text-amber-400">{q.bounty.amount_sats} sats</span>
                )}
              </div>
              {statusBadge(q.status)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProofPanel({ queries }: { queries: QuerySummary[] }) {
  // Find the latest query with HTLC info or verification
  const relevantQuery = queries.find((q) =>
    q.htlc || q.verification || q.payment_status === "released",
  );

  if (!relevantQuery) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-3 h-full">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Proof & Token Details
        </div>
        <p className="text-xs text-muted-foreground/50 italic">
          Waiting for query activity...
        </p>
      </div>
    );
  }

  const q = relevantQuery;
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 h-full">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Proof & Token Details
      </div>
      <div className="space-y-2 text-xs">
        {q.htlc && (
          <>
            <div>
              <span className="text-muted-foreground">HTLC Hash: </span>
              <span className="font-mono text-[11px] text-foreground break-all">
                {q.htlc.hash.slice(0, 16)}...
              </span>
            </div>
            {q.htlc.verified_escrow_sats != null && (
              <div>
                <span className="text-muted-foreground">Escrow: </span>
                <span className="text-amber-400 font-semibold">{q.htlc.verified_escrow_sats} sats</span>
                <span className="text-emerald-400 text-[10px] ml-1">verified</span>
              </div>
            )}
            {q.htlc.worker_pubkey && (
              <div>
                <span className="text-muted-foreground">Worker: </span>
                <span className="font-mono text-[11px] break-all">{q.htlc.worker_pubkey.slice(0, 16)}...</span>
              </div>
            )}
          </>
        )}
        {q.payment_status && (
          <div>
            <span className="text-muted-foreground">Payment: </span>
            <span className={
              q.payment_status === "released" ? "text-emerald-400 font-semibold"
              : q.payment_status === "cancelled" ? "text-red-400"
              : "text-amber-400"
            }>
              {q.payment_status}
            </span>
          </div>
        )}
        {q.verification && (
          <div className="mt-2 rounded-md border border-border p-2">
            <div className={`text-[10px] font-semibold mb-1 ${q.verification.passed ? "text-emerald-400" : "text-red-400"}`}>
              Verification: {q.verification.passed ? "PASSED" : "FAILED"}
            </div>
            {q.verification.checks.map((c, i) => (
              <div key={i} className="text-[10px] text-muted-foreground">
                {"\u2713"} {c}
              </div>
            ))}
            {q.verification.failures.map((f, i) => (
              <div key={i} className="text-[10px] text-red-400">
                {"\u2717"} {f}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const actorLabel: Record<string, { emoji: string; color: string }> = {
    requester: { emoji: "R", color: "bg-blue-400" },
    worker: { emoji: "W", color: "bg-emerald-400" },
    oracle: { emoji: "O", color: "bg-purple-400" },
    system: { emoji: "S", color: "bg-amber-400" },
  };

  const typeColor: Record<string, string> = {
    info: "text-foreground",
    success: "text-emerald-400",
    warning: "text-amber-400",
    error: "text-red-400",
  };

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 h-full flex flex-col">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Activity Timeline
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">
            Waiting for events... Create a query to begin.
          </p>
        ) : (
          events.map((evt, i) => {
            const actor = actorLabel[evt.actor] ?? actorLabel.system;
            return (
              <div key={i} className="flex items-start gap-2">
                <span className={`${actor.color} text-background text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5`}>
                  {actor.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <span className={`text-xs ${typeColor[evt.type]}`}>{evt.message}</span>
                  {evt.detail && (
                    <span className="text-[10px] text-muted-foreground ml-1.5">{evt.detail}</span>
                  )}
                </div>
                <span className="text-[9px] text-muted-foreground/50 tabular-nums shrink-0">
                  {new Date(evt.time).toLocaleTimeString()}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function LogsPanel() {
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

  const serviceColor = (svc: string): string => {
    if (svc.includes("cashu") || svc.includes("wallet")) return "text-amber-400";
    if (svc.includes("oracle")) return "text-purple-400";
    if (svc.includes("relay") || svc.includes("nostr")) return "text-blue-400";
    return "text-muted-foreground";
  };

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

// ---- Main Dashboard ----

export function DashboardApp() {
  const { data: requesterBalance, isLoading: reqLoading } = useQuery<BalanceData>({
    queryKey: ["dash-balance-requester"],
    queryFn: () => apiFetch(`/wallet/balance?role=requester&pubkey=${REQUESTER_PUBKEY}`).then((r) => r.json()),
    refetchInterval: 3000,
  });

  const { data: workerBalance, isLoading: wkrLoading } = useQuery<BalanceData>({
    queryKey: ["dash-balance-worker"],
    queryFn: () => apiFetch(`/wallet/balance?role=worker&pubkey=${WORKER_PUBKEY}`).then((r) => r.json()),
    refetchInterval: 3000,
  });

  const { data: queries = [] } = useQuery<QuerySummary[]>({
    queryKey: ["dash-queries"],
    queryFn: () => apiFetch("/queries/all").then((r) => r.json()),
    refetchInterval: 2000,
  });

  const currentStep = deriveCurrentStep(queries);
  const events = useActivityTracker(queries);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Anchr E2E Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Split view — watch Requester & Worker balances change in real time
            </p>
          </div>
          <StepIndicator currentStep={currentStep} />
        </div>
      </header>

      {/* Step description */}
      {currentStep >= 0 && currentStep < FLOW_STEPS.length && (
        <div className="border-b border-border px-6 py-2 bg-muted/30">
          <span className="text-xs text-muted-foreground">
            Current: <span className="text-foreground font-medium">{FLOW_STEPS[currentStep].description}</span>
          </span>
        </div>
      )}

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-3 gap-4 p-4 min-h-0" style={{ maxHeight: "calc(100vh - 200px)" }}>
        {/* Left: Requester */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex items-center gap-2 px-1">
            <span className="w-5 h-5 rounded-full bg-blue-400 text-background text-[10px] font-bold flex items-center justify-center">R</span>
            <span className="text-sm font-semibold">Requester</span>
          </div>
          <BalancePanel
            role="requester"
            label="Wallet Balance"
            color="blue"
            balance={requesterBalance}
            isLoading={reqLoading}
          />
          <div className="flex-1 min-h-0 overflow-y-auto">
            <QueryPanel queries={queries} label="All" color="blue" />
          </div>
        </div>

        {/* Center: Worker */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex items-center gap-2 px-1">
            <span className="w-5 h-5 rounded-full bg-emerald-400 text-background text-[10px] font-bold flex items-center justify-center">W</span>
            <span className="text-sm font-semibold">Worker</span>
          </div>
          <BalancePanel
            role="worker"
            label="Earned Balance"
            color="emerald"
            balance={workerBalance}
            isLoading={wkrLoading}
          />
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ProofPanel queries={queries} />
          </div>
        </div>

        {/* Right: Activity */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex items-center gap-2 px-1">
            <span className="text-sm font-semibold">Activity</span>
          </div>
          <div className="flex-1 min-h-0">
            <ActivityTimeline events={events} />
          </div>
        </div>
      </div>

      {/* Bottom: Logs */}
      <div className="border-t border-border h-48 p-4">
        <LogsPanel />
      </div>
    </div>
  );
}
