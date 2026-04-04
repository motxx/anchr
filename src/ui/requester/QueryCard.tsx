import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ImageIcon,
  Loader2,
  XCircle,
} from "lucide-react";
import React, { useState } from "react";
import { apiFetch } from "../api-config";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { cn } from "../lib/utils";
import { DecryptedImage } from "./DecryptedImage";
import { TlsnProofPanel } from "./TlsnProofPanel";

interface Bounty { amount_sats: number }
interface HtlcSummary { hash: string; oracle_pubkey: string; worker_pubkey: string | null; locktime: number }
interface BlossomKeyMaterial { encrypt_key: string; encrypt_iv: string }

interface QuerySummary {
  id: string;
  status: string;
  description: string;
  location_hint: string | null;
  bounty: Bounty | null;
  challenge_nonce: string | null;
  challenge_rule: string | null;
  expires_at: number;
  expires_in_seconds: number;
  htlc: HtlcSummary | null;
  quotes_count: number;
}

interface AttachmentInfo {
  id: string;
  uri: string;
  mime_type: string;
  storage_kind?: string;
}

interface TlsnVerifiedData {
  server_name: string;
  revealed_body: string;
  revealed_headers?: string;
  session_timestamp: number;
}

interface TlsnRequirement {
  target_url: string;
  method?: string;
  conditions?: { type: string; expression: string; expected?: string; description?: string }[];
}

interface QueryDetail extends QuerySummary {
  created_at: number;
  submitted_at?: number;
  payment_status: string;
  result?: { attachments: AttachmentInfo[]; notes?: string };
  verification?: {
    passed: boolean;
    checks: string[];
    failures: string[];
    tlsn_verified?: TlsnVerifiedData;
  };
  blossom_keys?: Record<string, BlossomKeyMaterial> | null;
  tlsn_requirements?: TlsnRequirement | null;
}

// ---- Helpers ----

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "\u53D7\u4ED8\u4E2D", variant: "secondary" },
  awaiting_quotes: { label: "\u898B\u7A4D\u5F85\u3061", variant: "secondary" },
  worker_selected: { label: "\u30EF\u30FC\u30AB\u30FC\u6C7A\u5B9A", variant: "default" },
  processing: { label: "\u51E6\u7406\u4E2D", variant: "default" },
  verifying: { label: "\u691C\u8A3C\u4E2D", variant: "default" },
  submitted: { label: "\u63D0\u51FA\u6E08\u307F", variant: "default" },
  approved: { label: "\u627F\u8A8D", variant: "default" },
  rejected: { label: "\u5374\u4E0B", variant: "destructive" },
  expired: { label: "\u671F\u9650\u5207\u308C", variant: "outline" },
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}\u79D2\u524D`;
  if (s < 3600) return `${Math.floor(s / 60)}\u5206\u524D`;
  if (s < 86400) return `${Math.floor(s / 3600)}\u6642\u9593\u524D`;
  return `${Math.floor(s / 86400)}\u65E5\u524D`;
}

function timeLeft(expiresAt: number): string {
  const s = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  if (s === 0) return "\u671F\u9650\u5207\u308C";
  if (s < 60) return `\u6B8B\u308A${s}\u79D2`;
  return `\u6B8B\u308A${Math.floor(s / 60)}\u5206`;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "approved":
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case "rejected":
      return <XCircle className="w-4 h-4 text-red-500" />;
    case "expired":
      return <Clock className="w-4 h-4 text-muted-foreground" />;
    case "processing":
    case "verifying":
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

// ---- Sub-components ----

function QueryMeta({ detail, query, isActive }: { detail?: QueryDetail; query: QuerySummary; isActive: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>{timeAgo(detail?.created_at ?? Date.now())}</span>
      {query.location_hint && <span>{query.location_hint}</span>}
      {isActive && <span className="text-amber-500">{timeLeft(query.expires_at)}</span>}
      {query.quotes_count > 0 && <span>{query.quotes_count}{"\u4EF6\u306E\u898B\u7A4D\u3082\u308A"}</span>}
    </div>
  );
}

function ChallengeNonce({ nonce, rule }: { nonce: string | null; rule: string | null }) {
  if (!nonce) return null;
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">Challenge Nonce</p>
      <p className="font-mono text-3xl font-black tracking-[0.3em] leading-none mb-2">{nonce}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{rule}</p>
    </div>
  );
}

function HtlcInfo({ htlc }: { htlc: HtlcSummary }) {
  return (
    <div className="rounded-xl border border-blue-950 bg-blue-950/30 px-3 py-3 space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-blue-400 font-bold">HTLC Escrow</p>
      <p className="text-xs text-muted-foreground font-mono truncate">Hash: {htlc.hash}</p>
      {htlc.worker_pubkey && (
        <p className="text-xs text-muted-foreground font-mono truncate">Worker: {htlc.worker_pubkey}</p>
      )}
    </div>
  );
}

function VerificationResult({ verification }: { verification: QueryDetail["verification"] }) {
  if (!verification) return null;
  return (
    <div className={cn(
      "rounded-xl border px-3 py-3",
      verification.passed ? "bg-emerald-950/30 border-emerald-800" : "bg-red-950/30 border-red-900",
    )}>
      <div className="flex items-center gap-2 mb-1">
        {verification.passed
          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          : <XCircle className="w-4 h-4 text-red-400" />}
        <span className={cn("text-sm font-semibold", verification.passed ? "text-emerald-400" : "text-red-400")}>
          {verification.passed ? "\u691C\u8A3COK" : "\u691C\u8A3CNG"}
        </span>
      </div>
      {verification.checks.length > 0 && (
        <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
          {verification.checks.map((c, i) => (
            <li key={i}>{verification.passed ? "\u2713" : ""} {c}</li>
          ))}
        </ul>
      )}
      {verification.failures.length > 0 && (
        <ul className="text-xs text-red-400 mt-1 space-y-0.5">
          {verification.failures.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
    </div>
  );
}

function AttachmentList({
  attachments,
  blossomKeys,
  notes,
}: {
  attachments: AttachmentInfo[];
  blossomKeys?: Record<string, BlossomKeyMaterial> | null;
  notes?: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <ImageIcon className="w-3.5 h-3.5" />
        {"\u6DFB\u4ED8\u30D5\u30A1\u30A4\u30EB"} ({attachments.length})
      </p>
      {attachments.map((att) => {
        const km = blossomKeys?.[att.id];
        if (km) return <DecryptedImage key={att.id} attachment={att} keyMaterial={km} />;
        return (
          <a
            key={att.id}
            href={att.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground hover:border-ring transition-colors truncate"
          >
            {att.mime_type}
          </a>
        );
      })}
      {notes && <p className="text-xs text-muted-foreground">{notes}</p>}
    </div>
  );
}

// ---- Main QueryCard ----

export function QueryCard({ query }: { query: QuerySummary }) {
  const [open, setOpen] = useState(false);
  const config = STATUS_CONFIG[query.status] ?? { label: query.status, variant: "outline" as const };
  const isActive = ["pending", "awaiting_quotes", "worker_selected", "processing", "verifying"].includes(query.status);

  const { data: detail } = useQuery<QueryDetail>({
    queryKey: ["query-detail", query.id],
    queryFn: () => apiFetch(`/queries/${query.id}`).then((r) => r.json()),
    enabled: open,
    refetchInterval: open && isActive ? 3000 : false,
  });

  return (
    <Card className={cn("overflow-hidden py-0 gap-0 transition-shadow rounded-2xl", open && "shadow-sm")}>
      <CardHeader
        className="px-4 py-4 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
              <StatusIcon status={query.status} />
            </div>
            <span className="text-[15px] font-semibold text-foreground truncate">{query.description}</span>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {query.bounty && query.bounty.amount_sats > 0 && (
              <span className="text-[13px] font-bold text-emerald-400 bg-emerald-950 rounded-full px-3 py-1">
                {query.bounty.amount_sats} sats
              </span>
            )}
            <Badge variant={config.variant} className="text-[10px]">{config.label}</Badge>
            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="px-4 pb-4 pt-3 border-t space-y-4">
          <QueryMeta detail={detail} query={query} isActive={isActive} />
          <ChallengeNonce nonce={query.challenge_nonce} rule={query.challenge_rule} />
          {query.htlc && <HtlcInfo htlc={query.htlc} />}

          {detail?.payment_status && detail.payment_status !== "none" && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{"\u652F\u6255\u3044:"}</span>
              <Badge variant="outline" className="text-[10px]">{detail.payment_status}</Badge>
            </div>
          )}

          <VerificationResult verification={detail?.verification} />

          {detail?.verification?.tlsn_verified && (
            <TlsnProofPanel verified={detail.verification.tlsn_verified} requirement={detail.tlsn_requirements} />
          )}

          {detail?.result?.attachments && detail.result.attachments.length > 0 && (
            <AttachmentList
              attachments={detail.result.attachments}
              blossomKeys={detail.blossom_keys}
              notes={detail.result.notes}
            />
          )}
        </CardContent>
      )}
    </Card>
  );
}
