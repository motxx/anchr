import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Clock,
  Loader2,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { apiFetch } from "./api-config";
import React, { useCallback } from "react";
import { ClosedQueryCard } from "./ClosedQueryCard";
import { LogsPanel } from "./LogsPanel";
import { QueryCard } from "./QueryCard";
import type { Query } from "./QueryCard";

// ---- Types ----

interface BalanceData {
  role: string;
  pubkey: string;
  balance_sats: number;
  pending_sats: number;
  mint_url: string | null;
}

const WORKER_PUBKEY = "worker_ui_placeholder_pubkey";
const OPEN_STATUSES = ["pending", "awaiting_quotes", "worker_selected", "processing"];

// ---- ClosedQueryList ----

function ClosedQueryList() {
  const { data: allQueries = [] } = useQuery<Query[]>({
    queryKey: ["queries-all"],
    queryFn: (): Promise<Query[]> => apiFetch("/queries/all").then((r) => r.json()),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  const closed = allQueries.filter((q) => !OPEN_STATUSES.includes(q.status ?? ""));

  if (!closed.length) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
        Completed Queries
        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{closed.length}</span>
      </h2>
      <div className="flex flex-col gap-3">
        {closed.map((q) => (
          <ClosedQueryCard key={q.id} query={q} />
        ))}
      </div>
    </div>
  );
}

// ---- QueryList ----

function QueryList({ onSubmitted }: { onSubmitted?: (id: string) => void }) {
  const { data: queries = [], isError } = useQuery<Query[]>({
    queryKey: ["queries"],
    queryFn: (): Promise<Query[]> => apiFetch("/queries").then((r) => r.json()),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <AlertCircle className="w-8 h-8" />
        <p className="text-sm font-medium">Could not reach server</p>
        <p className="text-xs">Is the server running?</p>
      </div>
    );
  }

  if (!queries.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Clock className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">No pending queries</p>
        <p className="text-xs text-muted-foreground/60">
          Live real-world queries will appear here {"\u00b7"} checking every 3s
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {queries.map((query) => (
        <QueryCard key={query.id} query={query} onSubmitted={onSubmitted} />
      ))}
    </div>
  );
}

// ---- BalanceCard ----

function BalanceCard() {
  const { data, isLoading } = useQuery<BalanceData>({
    queryKey: ["wallet-balance-worker"],
    queryFn: () =>
      apiFetch(`/wallet/balance?role=worker&pubkey=${WORKER_PUBKEY}`).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch balance");
        return r.json();
      }),
    refetchInterval: 5000,
  });

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card px-6 py-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-emerald-950 flex items-center justify-center">
            <Wallet className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
            Earned Balance
          </span>
        </div>
        {data?.pending_sats ? (
          <div className="flex items-center gap-1.5 bg-amber-950/50 rounded-full px-3 py-1">
            <span className="text-[11px] text-muted-foreground">Pending</span>
            <span className="text-[11px] font-bold text-amber-400">{data.pending_sats} sats</span>
          </div>
        ) : null}
      </div>
      <p className="text-4xl font-black text-foreground">
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <>{data?.balance_sats ?? 0} <span className="text-lg font-bold text-muted-foreground">sats</span></>
        )}
      </p>
    </div>
  );
}

// ---- App ----

export default function App() {
  const queryClient = useQueryClient();

  const { isFetching } = useQuery<Query[]>({
    queryKey: ["queries"],
    queryFn: (): Promise<Query[]> => apiFetch("/queries").then((r) => r.json()),
    staleTime: 2000,
  });

  const handleSubmitted = useCallback((_id: string) => {
    queryClient.invalidateQueries({ queryKey: ["queries-all"] });
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 max-w-2xl mx-auto px-5 py-10 w-full">
        <header className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-black text-foreground tracking-tight">Anchr</h1>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Earn sats by proving ground truth
              </p>
            </div>
            <div className="flex items-center gap-2 bg-card rounded-full px-3 py-1.5 border border-border">
              {isFetching ? (
                <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
              <span className="text-[11px] font-semibold text-muted-foreground">live</span>
            </div>
          </div>
        </header>

        <BalanceCard />

        <div className="space-y-8">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Open Queries</h2>
            </div>
            <QueryList onSubmitted={handleSubmitted} />
          </div>

          <ClosedQueryList />
        </div>
      </div>

      <LogsPanel />
    </div>
  );
}
