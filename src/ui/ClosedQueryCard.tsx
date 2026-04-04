import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Lock,
} from "lucide-react";
import React, { useState } from "react";
import { apiFetch } from "./api-config";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { cn } from "./lib/utils";
import { VerificationPanel, ResultProofPanel } from "./ResultProofPanel";
import type { Query } from "./QueryCard";

function isTlsnQuery(query: Query): boolean {
  return query.verification_requirements?.includes("tlsn") === true;
}

function StatusBadge({ status }: { status?: string }) {
  const cfg = status === "approved"
    ? { bg: "bg-emerald-950/50 text-emerald-400", label: "approved" }
    : status === "rejected"
    ? { bg: "bg-red-950/50 text-red-400", label: "rejected" }
    : status === "verifying"
    ? { bg: "bg-yellow-950/50 text-yellow-400", label: "verifying" }
    : status === "processing"
    ? { bg: "bg-blue-950/50 text-blue-400", label: "processing" }
    : { bg: "bg-zinc-800/50 text-muted-foreground", label: status ?? "unknown" };

  return (
    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", cfg.bg)}>
      {cfg.label}
    </span>
  );
}

function QueryTypeBadge({ query }: { query: Query }) {
  const tlsn = isTlsnQuery(query);
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded",
      tlsn ? "bg-blue-950/50 text-blue-400" : "bg-violet-950/50 text-violet-400",
    )}>
      {tlsn ? <Globe className="w-2.5 h-2.5" /> : <Camera className="w-2.5 h-2.5" />}
      {tlsn ? "Web Proof" : "Photo"}
    </span>
  );
}

function ClosedQueryDetail({ queryId }: { queryId: string }) {
  const { data: query, isLoading } = useQuery<Query>({
    queryKey: ["query", queryId],
    queryFn: (): Promise<Query> => apiFetch(`/queries/${queryId}`).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    }),
    staleTime: 10000,
  });

  if (isLoading || !query) {
    return (
      <CardContent className="px-4 pb-4 pt-3 border-t border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="text-xs">Loading details...</span>
        </div>
      </CardContent>
    );
  }

  return (
    <CardContent className="px-4 pb-5 pt-4 border-t border-border space-y-4">
      {query.tlsn_requirements && (
        <div className="flex items-center gap-1.5 text-xs">
          <Lock className="w-3 h-3 text-blue-400 shrink-0" />
          <span className="text-blue-400 font-mono truncate">{query.tlsn_requirements.target_url}</span>
        </div>
      )}

      {query.submission_meta && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>Channel: <span className="text-foreground">{query.submission_meta.channel}</span></span>
          <span>Executor: <span className="text-foreground">{query.submission_meta.executor_type}</span></span>
        </div>
      )}

      <VerificationPanel
        verification={query.verification}
        preimage={undefined}
        paymentStatus={query.payment_status}
        oracleId={query.assigned_oracle_id}
        htlc={query.htlc}
        attestations={query.attestations}
      />

      <ResultProofPanel queryId={query.id} result={query.result} />
    </CardContent>
  );
}

export function ClosedQueryCard({ query }: { query: Query }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className={cn("overflow-hidden py-0 gap-0", open && "border-border/80")}>
      <CardHeader
        className="px-4 py-3.5 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <StatusBadge status={query.status} />
            <QueryTypeBadge query={query} />
            <span className="text-sm text-foreground truncate">{query.description}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {query.bounty && query.bounty.amount_sats > 0 && (
              <span className="text-xs font-semibold text-amber-400">
                {query.bounty.amount_sats} sats
              </span>
            )}
            {open ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {open && <ClosedQueryDetail queryId={query.id} />}
    </Card>
  );
}
