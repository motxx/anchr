import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileUp,
  Globe,
  Loader2,
  Lock,
} from "lucide-react";
import React, { useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";
import { generatePluginCode } from "./plugin-codegen";

interface TlsnRequirement {
  target_url: string;
  conditions?: { type: string; expression: string; description?: string }[];
}

export interface TlsnWorkerQuery {
  id: string;
  description: string;
  tlsn_requirements?: TlsnRequirement | null;
  tlsn_verifier_url?: string | null;
  tlsn_proxy_url?: string | null;
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {children}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function TlsnTargetInfo({ req }: { req: TlsnRequirement }) {
  return (
    <div className="bg-black/30 rounded-lg px-3 py-2.5 space-y-1">
      <div className="flex items-center gap-1.5">
        <Lock className="w-3 h-3 text-blue-400" />
        <span className="text-xs text-blue-400 font-medium truncate">{req.target_url}</span>
      </div>
      {req.conditions?.map((c, i) => (
        <p key={i} className="text-[11px] text-muted-foreground ml-4">
          {c.description ?? `${c.type}: ${c.expression}`}
        </p>
      ))}
    </div>
  );
}

function ExtensionInstructions({
  pluginCode,
  copied,
  onCopy,
}: {
  pluginCode: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="bg-blue-950/20 border border-blue-900/30 rounded-lg px-3 py-3 space-y-3">
      <p className="text-xs font-medium text-blue-400 flex items-center gap-1.5">
        <ExternalLink className="w-3 h-3" />
        Prove with TLSNotary Extension
      </p>
      <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
        <li>Copy the plugin code below</li>
        <li>Open TLSNotary extension {"\u2192"} DevConsole</li>
        <li>Paste and click <strong className="text-foreground">Run Code</strong></li>
        <li>Result is copied to clipboard {"\u2014"} paste it below</li>
      </ol>
      <div className="relative group">
        <pre className="bg-black/50 rounded-lg p-3 overflow-x-auto text-[11px] leading-relaxed max-h-48 overflow-y-auto">
          <code className="text-emerald-300 font-mono whitespace-pre">{pluginCode}</code>
        </pre>
        <button
          onClick={onCopy}
          className="absolute top-2 right-2 p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-opacity flex items-center gap-1"
        >
          {copied ? (
            <><CheckCircle2 className="w-3 h-3 text-emerald-400" /><span className="text-[10px] text-emerald-400">Copied</span></>
          ) : (
            <><FileUp className="w-3 h-3 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">Copy</span></>
          )}
        </button>
      </div>
    </div>
  );
}

function PasteProofSection({
  pastedResult,
  onPastedResultChange,
  busy,
  onSubmit,
}: {
  pastedResult: string;
  onPastedResultChange: (v: string) => void;
  busy: boolean;
  onSubmit: (data: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel required>Paste proof result from extension</FieldLabel>
      <textarea
        className="w-full h-24 rounded-lg border border-border bg-black/30 px-3 py-2 text-xs text-foreground font-mono placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-blue-800"
        placeholder='Paste the JSON result here (auto-copied to clipboard after plugin runs)'
        value={pastedResult}
        onChange={(e) => onPastedResultChange(e.target.value)}
      />
      <Button
        className="w-full"
        disabled={busy || !pastedResult.trim()}
        onClick={() => {
          try {
            const proof = JSON.parse(pastedResult);
            onSubmit({ tlsn_extension_result: proof });
          } catch {
            onSubmit({ tlsn_extension_result: pastedResult });
          }
        }}
      >
        {busy ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Submitting{"\u2026"}</>
        ) : (
          "Submit Proof \u2192"
        )}
      </Button>
    </div>
  );
}

function ManualUploadSection({
  showManual,
  onToggle,
  fileName,
  fileRef,
  onFileChange,
  busy,
  onSubmitFile,
}: {
  showManual: boolean;
  onToggle: () => void;
  fileName: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (name: string | null) => void;
  busy: boolean;
  onSubmitFile: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {showManual ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Manual upload (.presentation.tlsn)
      </button>

      {showManual && (
        <div className="mt-2 space-y-2">
          <label
            className={cn(
              "flex flex-col items-center justify-center w-full rounded-lg border-2 border-dashed cursor-pointer transition-colors py-4",
              fileName
                ? "border-blue-800 bg-blue-950/20"
                : "border-border hover:border-blue-800/50 bg-muted/20 hover:bg-muted/40"
            )}
          >
            {fileName ? (
              <div className="flex items-center gap-2 text-blue-400">
                <FileUp className="w-4 h-4" />
                <span className="text-xs font-medium">{fileName}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <FileUp className="w-5 h-5" />
                <span className="text-xs">Select presentation file</span>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".tlsn,.bin,application/octet-stream"
              className="sr-only"
              onChange={(e) => onFileChange(e.target.files?.[0]?.name ?? null)}
            />
          </label>
          {fileName && (
            <>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { onFileChange(null); if (fileRef.current) fileRef.current.value = ""; }}
              >
                Remove
              </button>
              <Button className="w-full" size="sm" disabled={busy} onClick={onSubmitFile}>
                {busy ? <><Loader2 className="w-3 h-3 animate-spin" /> Submitting{"\u2026"}</> : "Submit File \u2192"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function TlsnWorkerPanel({
  query,
  onSubmit,
  isPending,
}: {
  query: TlsnWorkerQuery;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const req = query.tlsn_requirements;
  const [copied, setCopied] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [pastedResult, setPastedResult] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const apiOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const pluginCode = generatePluginCode(query, apiOrigin);

  function handleCopy() {
    navigator.clipboard.writeText(pluginCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSubmitFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setSubmitting(true);
    try {
      const buf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      onSubmit({ tlsn_presentation: base64 });
    } finally {
      setSubmitting(false);
    }
  }

  const busy = isPending || submitting;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          TLSNotary Web Proof
        </span>
      </div>

      {req?.target_url && <TlsnTargetInfo req={req} />}

      <ExtensionInstructions pluginCode={pluginCode} copied={copied} onCopy={handleCopy} />

      <PasteProofSection
        pastedResult={pastedResult}
        onPastedResultChange={setPastedResult}
        busy={busy}
        onSubmit={onSubmit}
      />

      <ManualUploadSection
        showManual={showManual}
        onToggle={() => setShowManual((v) => !v)}
        fileName={fileName}
        fileRef={fileRef}
        onFileChange={setFileName}
        busy={busy}
        onSubmitFile={handleSubmitFile}
      />
    </div>
  );
}
