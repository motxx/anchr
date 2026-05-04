import React from "react";

interface QuerySummary {
  id: string;
  status: string;
  description: string;
  bounty: { amount_sats: number } | null;
  escrow: {
    type: "htlc" | "p2pk_frost";
    hash: string;
    oracle_pubkeys: string[];
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
    q.escrow || q.verification || q.payment_status === "released",
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
        {q.escrow && <EscrowDetails escrow={q.escrow} />}
        {q.payment_status && <PaymentStatus status={q.payment_status} />}
        {q.verification && <VerificationBlock verification={q.verification} />}
      </div>
    </div>
  );
}

function EscrowDetails({ escrow }: {
  escrow: {
    type: "htlc" | "p2pk_frost";
    hash: string;
    worker_pubkey: string | null;
    verified_escrow_sats: number | null;
  };
}) {
  return (
    <>
      <div>
        <span className="text-muted-foreground">{escrow.type === "p2pk_frost" ? "P2PK Hash: " : "HTLC Hash: "}</span>
        <span className="font-mono text-[11px] text-foreground break-all">
          {escrow.hash.slice(0, 16)}...
        </span>
      </div>
      {escrow.verified_escrow_sats != null && (
        <div>
          <span className="text-muted-foreground">Escrow: </span>
          <span className="text-amber-400 font-semibold">{escrow.verified_escrow_sats} sats</span>
          <span className="text-emerald-400 text-[10px] ml-1">verified</span>
        </div>
      )}
      {escrow.worker_pubkey && (
        <div>
          <span className="text-muted-foreground">Worker: </span>
          <span className="font-mono text-[11px] break-all">{escrow.worker_pubkey.slice(0, 16)}...</span>
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
          ✓ {c}
        </div>
      ))}
      {verification.failures.map((f, i) => (
        <div key={i} className="text-[10px] text-red-400">
          ✗ {f}
        </div>
      ))}
    </div>
  );
}
