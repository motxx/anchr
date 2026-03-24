import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Code2, Inbox, LayoutDashboard, RefreshCw } from "lucide-react";
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
        { label: "Active", value: pending, color: "text-blue-400" },
        { label: "Verified", value: approved, color: "text-emerald-400" },
        { label: "Failed", value: rejected, color: "text-red-400" },
        { label: "Sats Spent", value: totalSats, color: "text-amber-400" },
      ].map((s) => (
        <div key={s.label} className="bg-card rounded-lg border border-border px-3 py-2.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{s.label}</p>
          <p className={`text-lg font-bold ${s.color} mt-0.5`}>{s.value}</p>
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
    <div className="flex gap-1 mb-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            active === t.key
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground"
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
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Inbox className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No queries match this filter</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
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
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">
                Anchr
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Verified data marketplace
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              {isFetching ? (
                <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              )}
              <span className="text-[11px] text-muted-foreground">live</span>
            </div>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 border-b border-border pb-px">
          {[
            { key: "dashboard" as Tab, label: "Dashboard", icon: LayoutDashboard },
            { key: "sdk" as Tab, label: "SDK", icon: Code2 },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Error state */}
        {isError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <AlertCircle className="w-8 h-8" />
            <p className="text-sm font-medium">Could not reach server</p>
          </div>
        )}

        {/* Dashboard tab */}
        {!isError && tab === "dashboard" && (
          <div className="space-y-6">
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
