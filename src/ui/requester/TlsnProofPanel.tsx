import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Globe,
  Lock,
} from "lucide-react";
import React, { useState } from "react";

interface TlsnCondition {
  type: string;
  expression: string;
  expected?: string;
  description?: string;
}

interface TlsnRequirement {
  target_url: string;
  method?: string;
  conditions?: TlsnCondition[];
}

interface TlsnVerifiedData {
  server_name: string;
  revealed_body: string;
  revealed_headers?: string;
  session_timestamp: number;
}

function TlsnConditions({ conditions }: { conditions?: TlsnCondition[] }) {
  if (!conditions || conditions.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Conditions</p>
      {conditions.map((cond, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
          <span className="text-xs text-muted-foreground">
            {cond.description ?? `${cond.type}: ${cond.expression}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function TlsnBodyToggle({
  showBody,
  onToggle,
  bodyDisplay,
  isJson,
}: {
  showBody: boolean;
  onToggle: () => void;
  bodyDisplay: string;
  isJson: boolean;
}) {
  return (
    <>
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={onToggle}
      >
        {showBody ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span className="font-medium">Server Response</span>
        {isJson && (
          <span className="bg-blue-500/20 text-blue-400 text-[9px] font-medium rounded px-1.5 py-0.5">JSON</span>
        )}
      </button>
      {showBody && (
        <pre className="bg-black/60 rounded-md p-3 text-xs text-emerald-300 font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
          {bodyDisplay}
        </pre>
      )}
    </>
  );
}

export function TlsnProofPanel({
  verified,
  requirement,
}: {
  verified: TlsnVerifiedData;
  requirement?: TlsnRequirement | null;
}) {
  const [showBody, setShowBody] = useState(false);

  let bodyDisplay: string;
  let isJson = false;
  try {
    bodyDisplay = JSON.stringify(JSON.parse(verified.revealed_body), null, 2);
    isJson = true;
  } catch {
    bodyDisplay = verified.revealed_body;
  }

  const ts = new Date(verified.session_timestamp * 1000).toLocaleString();

  return (
    <div className="rounded-lg border bg-card px-3 py-3 space-y-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
        <Lock className="w-3 h-3" /> TLSNotary Proof (cryptographically verified)
      </p>
      <div className="flex items-center gap-1.5">
        <Globe className="w-3.5 h-3.5 text-emerald-500" />
        <span className="text-sm font-medium text-foreground">{verified.server_name}</span>
      </div>
      <TlsnConditions conditions={requirement?.conditions} />
      <TlsnBodyToggle
        showBody={showBody}
        onToggle={() => setShowBody((v) => !v)}
        bodyDisplay={bodyDisplay}
        isJson={isJson}
      />
      <span className="text-[10px] text-muted-foreground">{ts}</span>
    </div>
  );
}
