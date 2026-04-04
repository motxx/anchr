import {
  CheckCircle2,
  Copy,
  Eye,
  Lock,
  Shield,
  XCircle,
} from "lucide-react";
import React, { useState } from "react";
import { cn } from "./lib/utils";

interface TlsnVerifiedData {
  server_name: string;
  revealed_body: string;
  revealed_headers?: string;
  session_timestamp: number;
}

interface VerificationDetail {
  passed: boolean;
  checks: string[];
  failures: string[];
  tlsn_verified?: TlsnVerifiedData;
}

interface OracleAttestationRecord {
  oracle_id: string;
  passed: boolean;
  checks: string[];
  failures: string[];
  attested_at: number;
  tlsn_verified?: TlsnVerifiedData;
}

interface HtlcSummary {
  hash: string;
  oracle_pubkey: string;
  worker_pubkey?: string | null;
  locktime: number;
  verified_escrow_sats?: number | null;
}

export interface VerificationPanelProps {
  verification?: VerificationDetail;
  preimage?: string | null;
  paymentStatus?: string;
  oracleId?: string | null;
  htlc?: HtlcSummary | null;
  attestations?: OracleAttestationRecord[] | null;
}

function ChecksList({ checks }: { checks: string[] }) {
  if (checks.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Checks</p>
      {checks.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>{c}</span>
        </div>
      ))}
    </div>
  );
}

function FailuresList({ failures }: { failures: string[] }) {
  if (failures.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Failures</p>
      {failures.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs text-red-400">
          <XCircle className="w-3 h-3 shrink-0" />
          <span>{f}</span>
        </div>
      ))}
    </div>
  );
}

function TlsnVerifiedPanel({ data }: { data: TlsnVerifiedData }) {
  const [bodyExpanded, setBodyExpanded] = useState(false);

  function formatBody(raw: string): string {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  }

  return (
    <div className="bg-blue-950/20 border border-blue-900/30 rounded-lg px-3 py-2.5 space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-blue-400 font-semibold flex items-center gap-1">
        <Shield className="w-3 h-3" />
        TLSNotary Verified Data
      </p>
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Server:</span>
          <span className="text-foreground font-mono">{data.server_name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Session:</span>
          <span className="text-foreground font-mono">
            {new Date(data.session_timestamp * 1000).toLocaleString()}
          </span>
        </div>
      </div>
      {data.revealed_body && (
        <div>
          <button
            type="button"
            onClick={() => setBodyExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
          >
            <Eye className="w-3 h-3" />
            {bodyExpanded ? "Hide" : "Show"} revealed body
          </button>
          {bodyExpanded && (
            <pre className="mt-1.5 bg-black/50 rounded-lg p-2.5 overflow-x-auto text-[11px] leading-relaxed max-h-48 overflow-y-auto">
              <code className="text-emerald-300 font-mono whitespace-pre">
                {formatBody(data.revealed_body)}
              </code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function HtlcInfoPanel({
  preimage,
  paymentStatus,
  htlc,
}: {
  preimage?: string | null;
  paymentStatus?: string;
  htlc?: HtlcSummary | null;
}) {
  const [copied, setCopied] = useState(false);

  if (!preimage && !(htlc && htlc.verified_escrow_sats)) return null;

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-3 py-2.5 space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-amber-400 font-semibold flex items-center gap-1">
        <Lock className="w-3 h-3" />
        HTLC Info
      </p>
      {preimage && (
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Preimage</span>
          <div className="flex items-center gap-2">
            <code className="text-xs text-amber-300 font-mono bg-black/30 px-2 py-1 rounded break-all flex-1">
              {preimage}
            </code>
            <button
              type="button"
              onClick={() => handleCopy(preimage)}
              className="p-1 rounded hover:bg-white/10 shrink-0"
            >
              {copied ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>
      )}
      {paymentStatus && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Payment:</span>
          <span className={cn(
            "font-medium",
            paymentStatus === "released" || paymentStatus === "htlc_swapped" ? "text-emerald-400" :
            paymentStatus === "cancelled" ? "text-red-400" : "text-amber-400"
          )}>{paymentStatus}</span>
        </div>
      )}
      {htlc?.verified_escrow_sats != null && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Escrow:</span>
          <span className="text-amber-400 font-semibold">{htlc.verified_escrow_sats} sats</span>
        </div>
      )}
    </div>
  );
}

function OracleAttestations({ attestations }: { attestations: OracleAttestationRecord[] }) {
  if (attestations.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Oracle Attestations</p>
      {attestations.map((a, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          {a.passed ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-3 h-3 text-red-400 shrink-0" />
          )}
          <span className="text-muted-foreground font-mono text-[10px] truncate">{a.oracle_id}</span>
          <span className={a.passed ? "text-emerald-400" : "text-red-400"}>
            {a.passed ? "pass" : "fail"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function VerificationPanel({
  verification,
  preimage,
  paymentStatus,
  oracleId,
  htlc,
  attestations,
}: VerificationPanelProps) {
  if (!verification && !preimage) return null;

  return (
    <div className="space-y-3">
      {verification && <ChecksList checks={verification.checks} />}
      {verification && <FailuresList failures={verification.failures} />}
      {verification?.tlsn_verified && <TlsnVerifiedPanel data={verification.tlsn_verified} />}
      <HtlcInfoPanel preimage={preimage} paymentStatus={paymentStatus} htlc={htlc} />
      {attestations && <OracleAttestations attestations={attestations} />}
      {oracleId && !attestations?.length && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Oracle:</span>
          <span className="text-foreground font-mono text-[10px]">{oracleId}</span>
        </div>
      )}
    </div>
  );
}
