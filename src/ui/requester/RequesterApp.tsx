import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Code2, Inbox, LayoutDashboard, Loader2, RefreshCw, Wallet } from "lucide-react";
import React, { useState } from "react";
import { apiFetch } from "../api-config";
import { CreateQueryForm } from "./CreateQueryForm";
import { QueryCard } from "./QueryCard";
import { SdkPlayground } from "./SdkPlayground";

interface QuerySummary {
  id: string;
  status: string;
  description: string;
  location_hint: string | null;
  bounty: { amount_sats: number } | null;
  challenge_nonce: string | null;
  challenge_rule: string | null;
  verification_requirements?: string[];
  expires_at: number;
  expires_in_seconds: number;
  htlc: {
    hash: string;
    oracle_pubkey: string;
    worker_pubkey: string | null;
    locktime: number;
  } | null;
  quotes_count: number;
}

type Tab = "dashboard" | "sdk";
type Filter = "all" | "pending" | "approved" | "rejected";

const REQUESTER_PUBKEY = "requester_demo";

interface BalanceData {
  role: string;
  pubkey: string;
  balance_sats: number;
  pending_sats: number;
  mint_url: string | null;
}

function BalanceHeader() {
  const { data, isLoading } = useQuery<BalanceData>({
    queryKey: ["wallet-balance-requester"],
    queryFn: () =>
      apiFetch(`/wallet/balance?role=requester&pubkey=${REQUESTER_PUBKEY}`).then((r) => {
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
            Wallet Balance
          </span>
        </div>
        <div className="flex items-center gap-3">
          {data?.pending_sats ? (
            <div className="flex items-center gap-1.5 bg-amber-950/50 rounded-full px-3 py-1">
              <span className="text-[11px] text-muted-foreground">Escrow</span>
              <span className="text-[11px] font-bold text-amber-400">
                {data.pending_sats} sats
              </span>
            </div>
          ) : null}
          {data?.mint_url ? (
            <span className="text-[10px] text-emerald-500/60 bg-emerald-950/50 rounded-full px-2 py-0.5">mint-verified</span>
          ) : null}
        </div>
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

function Stats({ queries }: { queries: QuerySummary[] }) {
  const pending = queries.filter((q) => ["pending", "processing", "verifying", "submitted"].includes(q.status)).length;
  const approved = queries.filter((q) => q.status === "approved").length;
  const rejected = queries.filter((q) => q.status === "rejected").length;
  const totalSats = queries
    .filter((q) => q.status === "approved" && q.bounty)
    .reduce((sum, q) => sum + (q.bounty?.amount_sats ?? 0), 0);

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {[
        { label: "Active", value: pending, color: "text-blue-400", bg: "bg-blue-950/30" },
        { label: "Verified", value: approved, color: "text-emerald-400", bg: "bg-emerald-950/30" },
        { label: "Failed", value: rejected, color: "text-red-400", bg: "bg-red-950/30" },
        { label: "Sats Spent", value: totalSats, color: "text-amber-400", bg: "bg-amber-950/30" },
      ].map((s) => (
        <div key={s.label} className="bg-card rounded-2xl border border-border px-4 py-3.5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{s.label}</p>
          <p className={`text-2xl font-black ${s.color} mt-1`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function FilterTabs({ active, onChange }: { active: Filter; onChange: (f: Filter) => void }) {
  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Active" },
    { key: "approved", label: "Verified" },
    { key: "rejected", label: "Failed" },
  ];

  return (
    <div className="flex gap-1.5 mb-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            active === t.key
              ? "bg-emerald-950 text-emerald-400"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function QueryList({ queries }: { queries: QuerySummary[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = queries.filter((q) => {
    if (filter === "all") return true;
    if (filter === "pending") return ["pending", "processing", "verifying", "submitted", "awaiting_quotes", "worker_selected"].includes(q.status);
    if (filter === "approved") return q.status === "approved";
    if (filter === "rejected") return q.status === "rejected" || q.status === "expired";
    return true;
  });

  return (
    <div>
      <FilterTabs active={filter} onChange={setFilter} />
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-14 h-14 rounded-full bg-card flex items-center justify-center">
            <Inbox className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No queries match this filter</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((q) => (
            <QueryCard key={q.id} query={q} />
          ))}
        </div>
      )}
    </div>
  );
}

export function RequesterApp() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const { data: queries = [], isError, isFetching } = useQuery<QuerySummary[]>({
    queryKey: ["queries-all"],
    queryFn: () => apiFetch("/queries/all").then((r) => r.json()),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-5 py-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-black text-foreground tracking-tight">
                Anchr
              </h1>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Verified data marketplace
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

        {/* Tab Navigation */}
        <div className="flex gap-1.5 mb-6">
          {[
            { key: "dashboard" as Tab, label: "Dashboard", icon: LayoutDashboard },
            { key: "sdk" as Tab, label: "SDK", icon: Code2 },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                tab === t.key
                  ? "bg-card text-foreground border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Error state */}
        {isError && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <div className="w-16 h-16 rounded-full bg-card flex items-center justify-center">
              <AlertCircle className="w-7 h-7" />
            </div>
            <p className="text-[15px] font-semibold text-foreground">No connection</p>
            <p className="text-sm text-muted-foreground">Could not reach server</p>
          </div>
        )}

        {/* Dashboard tab */}
        {!isError && tab === "dashboard" && (
          <div className="space-y-6">
            <BalanceHeader />
            <Stats queries={queries} />
            <CreateQueryForm />
            <QueryList queries={queries} />
          </div>
        )}

        {/* SDK tab */}
        {tab === "sdk" && <SdkPlayground />}
      </div>
    </div>
  );
}
