import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
} from "lucide-react";
import React, { useState } from "react";
import { apiFetch } from "./api-config";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { cn } from "./lib/utils";
import { SubmitForm } from "./SubmitForm";
import { TlsnWorkerPanel } from "./TlsnWorkerPanel";
import { VerificationPanel } from "./ResultProofPanel";

interface VerificationDetail {
  passed: boolean;
  checks: string[];
  failures: string[];
  tlsn_verified?: { server_name: string; revealed_body: string; revealed_headers?: string; session_timestamp: number };
}

export interface Query {
  id: string;
  description: string;
  challenge_nonce: string | null;
  challenge_rule: string | null;
  verification_requirements?: string[];
  tlsn_requirements?: { target_url: string; conditions?: { type: string; expression: string; description?: string }[] } | null;
  status?: string;
  expires_at: number;
  expires_in_seconds: number;
  bounty?: { amount_sats: number } | null;
  tlsn_verifier_url?: string | null;
  tlsn_proxy_url?: string | null;
  verification?: VerificationDetail;
  payment_status?: string;
  htlc?: { hash: string; oracle_pubkey: string; worker_pubkey?: string | null; locktime: number; verified_escrow_sats?: number | null } | null;
  submitted_at?: number;
  assigned_oracle_id?: string | null;
  attestations?: { oracle_id: string; passed: boolean; checks: string[]; failures: string[]; attested_at: number }[] | null;
  result?: {
    attachments: { id: string; uri: string; mime_type: string; storage_kind: string; filename?: string; size_bytes?: number }[];
    notes?: string;
    gps?: { lat: number; lon: number };
    tlsn_attestation?: { presentation: string };
    tlsn_extension_result?: unknown;
  };
  submission_meta?: { executor_type: string; channel: string };
}

interface ResultResponse {
  ok: boolean;
  message: string;
  verification?: VerificationDetail;
  oracle_id?: string | null;
  payment_status?: string;
  preimage?: string | null;
}

// ---- Helpers ----

const WORKER_PUBKEY = "worker_ui_placeholder_pubkey";
const STORAGE_KEY = "anchr_worker_queries";
const MAX_STORED = 20;

function addStoredQueryId(id: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    const next = [id, ...ids.filter((x) => x !== id)].slice(0, MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

function timeLeft(expiresAt: number): string {
  const s = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  if (s === 0) return "expired";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

function timerClasses(expiresAt: number): string {
  const s = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  if (s < 10) return "text-red-400 font-bold tabular-nums";
  if (s < 60) return "text-amber-400 font-semibold tabular-nums";
  return "text-muted-foreground tabular-nums";
}

function isTlsnQuery(query: Query): boolean {
  return query.verification_requirements?.includes("tlsn") === true;
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

// ---- Sub-components ----

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

function QueryCardHeader({ query, open }: { query: Query; open: boolean }) {
  const tlsn = isTlsnQuery(query);
  return (
    <div className="flex items-center justify-between gap-3 w-full">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <QueryTypeBadge query={query} />
        <span className="text-sm text-foreground truncate">{query.description}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {tlsn && query.tlsn_requirements && (
          <span className="text-[10px] text-blue-400/70 hidden sm:inline">
            {extractDomain(query.tlsn_requirements.target_url)}
          </span>
        )}
        {query.bounty && query.bounty.amount_sats > 0 && (
          <span className="text-xs font-semibold text-amber-400">
            {query.bounty.amount_sats} sats
          </span>
        )}
        <span className={cn("text-xs flex items-center gap-1", timerClasses(query.expires_at))}>
          <Clock className="w-3 h-3 shrink-0" />
          {timeLeft(query.expires_at)}
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

function NonceBox({ nonce, rule }: { nonce: string | null; rule: string | null }) {
  if (!nonce) return null;
  return (
    <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg px-4 py-4">
      <p className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold mb-2">
        Challenge Nonce
      </p>
      <p className="font-mono text-5xl font-black text-amber-400 tracking-[0.4em] leading-none mb-3">
        {nonce}
      </p>
      <p className="text-sm text-foreground/80 leading-relaxed">{rule}</p>
    </div>
  );
}

function ResultFeedback({
  mut,
  resultData,
}: {
  mut: { isSuccess: boolean; isError: boolean; data?: ResultResponse; error?: Error | null };
  resultData: ResultResponse | null;
}) {
  return (
    <>
      {mut.isSuccess && mut.data && (
        <>
          <div className={cn(
            "flex items-start gap-3 p-3.5 rounded-lg text-sm leading-relaxed",
            mut.data.ok
              ? "bg-emerald-950/50 border border-emerald-800/60 text-emerald-400"
              : "bg-red-950/50 border border-red-900/60 text-red-400"
          )}>
            {mut.data.ok ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <div className="space-y-1">
              <p>{mut.data.message}</p>
            </div>
          </div>
          {resultData && (
            <VerificationPanel
              verification={resultData.verification}
              preimage={resultData.preimage}
              paymentStatus={resultData.payment_status}
              oracleId={resultData.oracle_id}
            />
          )}
        </>
      )}

      {mut.isError && (
        <div className="flex items-center gap-2.5 p-3.5 rounded-lg text-sm bg-red-950/50 border border-red-900/60 text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {mut.error?.message || "Network error"}
        </div>
      )}
    </>
  );
}

// ---- Main QueryCard ----

export function QueryCard({ query, onSubmitted }: { query: Query; onSubmitted?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const [resultData, setResultData] = useState<ResultResponse | null>(null);
  const tlsn = isTlsnQuery(query);

  React.useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const mut = useMutation<ResultResponse, Error, Record<string, unknown>>({
    mutationFn: async (body) => {
      const r = await apiFetch(`/queries/${query.id}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_pubkey: WORKER_PUBKEY, ...body }),
      });
      if (!r.ok && r.status >= 500)
        throw new Error(`Server error ${r.status}`);
      return r.json() as Promise<ResultResponse>;
    },
    onSuccess: (data) => {
      setResultData(data);
      if (data.ok) {
        addStoredQueryId(query.id);
        onSubmitted?.(query.id);
      }
    },
  });

  const submitted = mut.isSuccess && mut.data.ok;

  return (
    <Card className={cn("overflow-hidden py-0 gap-0", open && "border-border/80")}>
      <CardHeader
        className="px-4 py-3.5 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <QueryCardHeader query={query} open={open} />
      </CardHeader>

      {open && (
        <CardContent className="px-4 pb-5 pt-4 border-t border-border space-y-5">
          <NonceBox nonce={query.challenge_nonce} rule={query.challenge_rule} />

          {tlsn && !submitted ? (
            <TlsnWorkerPanel query={query} onSubmit={mut.mutate} isPending={mut.isPending} />
          ) : !tlsn && !submitted ? (
            <div className="pt-1">
              <SubmitForm queryId={query.id} onSubmit={mut.mutate} isPending={mut.isPending} />
            </div>
          ) : null}

          <ResultFeedback mut={mut} resultData={resultData} />
        </CardContent>
      )}
    </Card>
  );
}
