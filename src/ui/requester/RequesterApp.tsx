import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import React from "react";
import { apiFetch } from "../api-config";
import { CreateQueryForm } from "./CreateQueryForm";
import { QueryCard } from "./QueryCard";

interface QuerySummary {
  id: string;
  status: string;
  description: string;
  location_hint: string | null;
  bounty: { amount_sats: number } | null;
  challenge_nonce: string | null;
  challenge_rule: string | null;
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

function QueryList() {
  const { data: queries = [], isError } = useQuery<QuerySummary[]>({
    queryKey: ["queries-all"],
    queryFn: () => apiFetch("/queries/all").then((r) => r.json()),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <AlertCircle className="w-8 h-8" />
        <p className="text-sm font-medium">サーバーに接続できません</p>
      </div>
    );
  }

  if (!queries.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Inbox className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          リクエストはまだありません
        </p>
        <p className="text-xs text-muted-foreground/60">
          上のボタンから新しいリクエストを作成してください
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {queries.map((q) => (
        <QueryCard key={q.id} query={q} />
      ))}
    </div>
  );
}

export function RequesterApp() {
  const { isFetching } = useQuery<QuerySummary[]>({
    queryKey: ["queries-all"],
    queryFn: () => apiFetch("/queries/all").then((r) => r.json()),
    staleTime: 2000,
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <header className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">
                Anchr
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                リクエスト管理
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

        <div className="space-y-6">
          <CreateQueryForm />
          <QueryList />
        </div>
      </div>
    </div>
  );
}
