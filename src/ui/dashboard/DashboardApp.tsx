import { useQuery } from "@tanstack/react-query";
import React from "react";
import { apiFetch } from "../api-config";
import { ActivityTimeline } from "./ActivityTimeline";
import { DashboardLogsPanel } from "./LogsPanel";
import { ProofPanel } from "./ProofPanel";
import { useActivityTracker } from "./useActivityTracker";

const WORKER_PUBKEY = "worker_ui_placeholder_pubkey";
const REQUESTER_PUBKEY = "requester_demo";

interface BalanceData { role: string; pubkey: string; balance_sats: number; pending_sats: number; mint_url: string | null }

interface QuerySummary {
  id: string;
  status: string;
  description: string;
  bounty: { amount_sats: number } | null;
  htlc: { hash: string; oracle_pubkey: string; worker_pubkey: string | null; locktime: number; verified_escrow_sats: number | null } | null;
  payment_status?: string;
  verification?: { passed: boolean; checks: string[]; failures: string[] };
  created_at?: number;
  submitted_at?: number;
  expires_at: number;
}

interface FlowStep { label: string; description: string; actor: "requester" | "worker" | "oracle" | "system" }

const FLOW_STEPS: FlowStep[] = [
  { label: "Create Query", description: "Requester posts a bounty query", actor: "requester" },
  { label: "Worker Accepts", description: "Worker picks up the job", actor: "worker" },
  { label: "Submit Proof", description: "Worker submits photo/TLSNotary proof", actor: "worker" },
  { label: "Verification", description: "Oracle verifies the proof", actor: "oracle" },
  { label: "Settlement", description: "BTC transferred to worker", actor: "system" },
];

function deriveCurrentStep(queries: QuerySummary[]): number {
  if (queries.length === 0) return -1;
  const latest = queries[0]!;
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
  label,
  color,
  balance,
  isLoading,
}: {
  label: string;
  color: string;
  balance: BalanceData | undefined;
  isLoading: boolean;
}) {
  const colorMap: Record<string, { text: string; bg: string; border: string }> = {
    blue: { text: "text-blue-400", bg: "bg-blue-950/30", border: "border-blue-400/20" },
    emerald: { text: "text-emerald-400", bg: "bg-emerald-950/30", border: "border-emerald-400/20" },
  };
  const c = colorMap[color] ?? colorMap.blue!;

  return (
    <div className={`rounded-lg border ${c!.border} ${c!.bg} p-3`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        {balance?.mint_url && (
          <span className="text-[9px] text-emerald-500/60">mint-verified</span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${c!.text} tabular-nums`}>
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
  const c = colorMap[color] ?? colorMap.blue!;

  return (
    <div className={`rounded-lg border ${c!.border} ${c!.bg} p-3`}>
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
              <StatusBadge status={q.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
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
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Anchr E2E Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Split view {"\u2014"} watch Requester & Worker balances change in real time
            </p>
          </div>
          <StepIndicator currentStep={currentStep} />
        </div>
      </header>

      {currentStep >= 0 && currentStep < FLOW_STEPS.length && (
        <div className="border-b border-border px-6 py-2 bg-muted/30">
          <span className="text-xs text-muted-foreground">
            Current: <span className="text-foreground font-medium">{FLOW_STEPS[currentStep]!.description}</span>
          </span>
        </div>
      )}

      <div className="flex-1 grid grid-cols-3 gap-4 p-4 min-h-0" style={{ maxHeight: "calc(100vh - 200px)" }}>
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex items-center gap-2 px-1">
            <span className="w-5 h-5 rounded-full bg-blue-400 text-background text-[10px] font-bold flex items-center justify-center">R</span>
            <span className="text-sm font-semibold">Requester</span>
          </div>
          <BalancePanel
            label="Wallet Balance"
            color="blue"
            balance={requesterBalance}
            isLoading={reqLoading}
          />
          <div className="flex-1 min-h-0 overflow-y-auto">
            <QueryPanel queries={queries} label="All" color="blue" />
          </div>
        </div>

        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex items-center gap-2 px-1">
            <span className="w-5 h-5 rounded-full bg-emerald-400 text-background text-[10px] font-bold flex items-center justify-center">W</span>
            <span className="text-sm font-semibold">Worker</span>
          </div>
          <BalancePanel
            label="Earned Balance"
            color="emerald"
            balance={workerBalance}
            isLoading={wkrLoading}
          />
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ProofPanel queries={queries} />
          </div>
        </div>

        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex items-center gap-2 px-1">
            <span className="text-sm font-semibold">Activity</span>
          </div>
          <div className="flex-1 min-h-0">
            <ActivityTimeline events={events} />
          </div>
        </div>
      </div>

      <div className="border-t border-border h-48 p-4">
        <DashboardLogsPanel />
      </div>
    </div>
  );
}
