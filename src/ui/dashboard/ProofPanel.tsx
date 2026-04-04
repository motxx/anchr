import React from "react";

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
}

export function ProofPanel({ queries }: { queries: QuerySummary[] }) {
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
        {q.htlc && <HtlcDetails htlc={q.htlc} />}
        {q.payment_status && <PaymentStatus status={q.payment_status} />}
        {q.verification && <VerificationBlock verification={q.verification} />}
      </div>
    </div>
  );
}

function HtlcDetails({ htlc }: {
  htlc: {
    hash: string;
    worker_pubkey: string | null;
    verified_escrow_sats: number | null;
  };
}) {
  return (
    <>
      <div>
        <span className="text-muted-foreground">HTLC Hash: </span>
        <span className="font-mono text-[11px] text-foreground break-all">
          {htlc.hash.slice(0, 16)}...
        </span>
      </div>
      {htlc.verified_escrow_sats != null && (
        <div>
          <span className="text-muted-foreground">Escrow: </span>
          <span className="text-amber-400 font-semibold">{htlc.verified_escrow_sats} sats</span>
          <span className="text-emerald-400 text-[10px] ml-1">verified</span>
        </div>
      )}
      {htlc.worker_pubkey && (
        <div>
          <span className="text-muted-foreground">Worker: </span>
          <span className="font-mono text-[11px] break-all">{htlc.worker_pubkey.slice(0, 16)}...</span>
        </div>
      )}
    </>
  );
}

function PaymentStatus({ status }: { status: string }) {
  return (
    <div>
      <span className="text-muted-foreground">Payment: </span>
      <span className={
        status === "released" ? "text-emerald-400 font-semibold"
        : status === "cancelled" ? "text-red-400"
        : "text-amber-400"
      }>
        {status}
      </span>
    </div>
  );
}

function VerificationBlock({ verification }: {
  verification: { passed: boolean; checks: string[]; failures: string[] };
}) {
  return (
    <div className="mt-2 rounded-md border border-border p-2">
      <div className={`text-[10px] font-semibold mb-1 ${verification.passed ? "text-emerald-400" : "text-red-400"}`}>
        Verification: {verification.passed ? "PASSED" : "FAILED"}
      </div>
      {verification.checks.map((c, i) => (
        <div key={i} className="text-[10px] text-muted-foreground">
          {"\u2713"} {c}
        </div>
      ))}
      {verification.failures.map((f, i) => (
        <div key={i} className="text-[10px] text-red-400">
          {"\u2717"} {f}
        </div>
      ))}
    </div>
  );
}
