import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Globe,
  Camera,
  ExternalLink,
  Eye,
  FileText,
  FileUp,
  Image,
  Loader2,
  Lock,
  MapPin,
  Paperclip,
  RefreshCw,
  Shield,
  Terminal,
  Wallet,
  XCircle,
} from "lucide-react";
import { apiFetch } from "./api-config";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "./components/ui/card";
import { Input } from "./components/ui/input";
import { cn } from "./lib/utils";
import type { AttachmentRef, BlossomKeyMap, BlossomKeyMaterial } from "../types";

// ---- Types ----

interface Bounty {
  amount_sats: number;
}

interface TlsnCondition {
  type: string;
  expression: string;
  description?: string;
}

interface TlsnRequirement {
  target_url: string;
  conditions?: TlsnCondition[];
}

interface UploadResponse {
  ok: boolean;
  attachment?: AttachmentRef;
  encryption?: BlossomKeyMaterial;
  error?: string;
}

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

interface GpsCoord {
  lat: number;
  lon: number;
}

interface QueryResultAttachment {
  id: string;
  uri: string;
  mime_type: string;
  storage_kind: string;
  filename?: string;
  size_bytes?: number;
}

interface QueryResultData {
  attachments: QueryResultAttachment[];
  notes?: string;
  gps?: GpsCoord;
  tlsn_attestation?: { presentation: string };
  tlsn_extension_result?: unknown;
}

interface SubmissionMeta {
  executor_type: string;
  channel: string;
}

interface Query {
  id: string;
  description: string;
  challenge_nonce: string | null;
  challenge_rule: string | null;
  verification_requirements?: string[];
  tlsn_requirements?: TlsnRequirement | null;
  status?: string;
  expires_at: number;
  expires_in_seconds: number;
  bounty?: Bounty | null;
  tlsn_verifier_url?: string | null;
  tlsn_proxy_url?: string | null;
  // Detail fields (from GET /queries/:id)
  verification?: VerificationDetail;
  payment_status?: string;
  htlc?: HtlcSummary | null;
  submitted_at?: number;
  assigned_oracle_id?: string | null;
  attestations?: OracleAttestationRecord[] | null;
  result?: QueryResultData;
  submission_meta?: SubmissionMeta;
}

interface ResultResponse {
  ok: boolean;
  message: string;
  verification?: VerificationDetail;
  oracle_id?: string | null;
  payment_status?: string;
  preimage?: string | null;
}

// ---- localStorage helpers ----

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

// ---- Helpers ----

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

// ---- Type badge ----

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

// ---- TLSNotary Worker panel ----

function generatePluginCode(query: Query, apiOrigin: string): string {
  const req = query.tlsn_requirements;
  if (!req) return "";
  const url = req.target_url;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }

  // Use query-provided URLs, or sensible defaults
  const verifierUrl = query.tlsn_verifier_url || "ws://localhost:7048";
  const proxyUrl = query.tlsn_proxy_url || `ws://localhost:7048/proxy?token=${hostname}`;

  return `// Anchr plugin — auto-proves and submits
const QUERY_ID = '${query.id}';
const API = '${apiOrigin}';
const VERIFIER_URL = '${verifierUrl}';
const PROXY_URL = '${proxyUrl}';

export default {
  config: {
    name: 'Anchr: ${hostname}',
    description: '${query.description.replace(/'/g, "\\'")}',
    requests: [{
      method: 'GET',
      host: '${hostname}',
      pathname: '/**',
      verifierUrl: VERIFIER_URL,
    }],
  },
  main: async () => {
    const proof = await prove(
      {
        url: '${url}',
        method: 'GET',
        headers: {
          'Host': '${hostname}',
          'User-Agent': 'anchr-worker/1.0',
          'Accept': 'application/json',
          'Accept-Encoding': 'identity',
          'Connection': 'close',
        },
      },
      {
        verifierUrl: VERIFIER_URL,
        proxyUrl: PROXY_URL,
        maxRecvData: 16384,
        maxSentData: 4096,
        handlers: [
          { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
          { type: 'RECV', part: 'STATUS_CODE', action: 'REVEAL' },
          { type: 'RECV', part: 'BODY', action: 'REVEAL' },
        ],
      }
    );

    // Copy result for pasting into Anchr Worker page
    try {
      await navigator.clipboard.writeText(JSON.stringify(proof));
      console.log('[Anchr] Result copied to clipboard — paste it in the Worker page');
    } catch (e) {
      console.log('[Anchr] Copy to clipboard:', JSON.stringify(proof));
    }

    done(proof);
  },
};`;
}

function TlsnWorkerPanel({
  query,
  onSubmit,
  isPending,
}: {
  query: Query;
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
      {/* Target info */}
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          TLSNotary Web Proof
        </span>
      </div>

      {req?.target_url && (
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
      )}

      {/* Extension integration */}
      <div className="bg-blue-950/20 border border-blue-900/30 rounded-lg px-3 py-3 space-y-3">
        <p className="text-xs font-medium text-blue-400 flex items-center gap-1.5">
          <ExternalLink className="w-3 h-3" />
          Prove with TLSNotary Extension
        </p>
        <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Copy the plugin code below</li>
          <li>Open TLSNotary extension → DevConsole</li>
          <li>Paste and click <strong className="text-foreground">Run Code</strong></li>
          <li>Result is copied to clipboard — paste it below</li>
        </ol>

        {/* Plugin code */}
        <div className="relative group">
          <pre className="bg-black/50 rounded-lg p-3 overflow-x-auto text-[11px] leading-relaxed max-h-48 overflow-y-auto">
            <code className="text-emerald-300 font-mono whitespace-pre">{pluginCode}</code>
          </pre>
          <button
            onClick={handleCopy}
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

      {/* Paste result */}
      <div className="space-y-2">
        <FieldLabel required>Paste proof result from extension</FieldLabel>
        <textarea
          className="w-full h-24 rounded-lg border border-border bg-black/30 px-3 py-2 text-xs text-foreground font-mono placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-blue-800"
          placeholder='Paste the JSON result here (auto-copied to clipboard after plugin runs)'
          value={pastedResult}
          onChange={(e) => setPastedResult(e.target.value)}
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
            <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
          ) : (
            "Submit Proof →"
          )}
        </Button>
      </div>

      {/* Manual upload fallback */}
      <div>
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
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
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              />
            </label>
            {fileName && (
              <>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setFileName(null); if (fileRef.current) fileRef.current.value = ""; }}
                >
                  Remove
                </button>
                <Button className="w-full" size="sm" disabled={busy} onClick={handleSubmitFile}>
                  {busy ? <><Loader2 className="w-3 h-3 animate-spin" /> Submitting…</> : "Submit File →"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Submit form (photo queries) ----

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {children}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function SubmitForm({
  query,
  onSubmit,
  isPending,
}: {
  query: Query;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const notesRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setPreview(null); return; }
    setPreview(URL.createObjectURL(file));
  }

  const selectedFile = fileRef.current?.files?.[0];
  const isVideo = selectedFile?.type.startsWith("video/") ?? false;

  async function handleSubmit() {
    let attachments: AttachmentRef[] = [];
    let encryptionKeys: BlossomKeyMap = {};
    const file = fileRef.current?.files?.[0];
    if (file) {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("photo", file);
        const res = await apiFetch(`/queries/${query.id}/upload`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json() as UploadResponse;
        if (!data.ok) throw new Error(data.error ?? "Upload failed");
        if (data.attachment) {
          attachments = [data.attachment];
          if (data.encryption && data.attachment.id) {
            encryptionKeys[data.attachment.id] = data.encryption;
          }
        }
      } finally {
        setUploading(false);
      }
    }
    onSubmit({
      attachments,
      notes: notesRef.current?.value ?? "",
      ...(Object.keys(encryptionKeys).length > 0 ? { encryption_keys: encryptionKeys } : {}),
    });
  }

  const busy = isPending || uploading;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <FieldLabel required>Photo / Video</FieldLabel>
        <label
          className={cn(
            "flex flex-col items-center justify-center w-full rounded-lg border-2 border-dashed cursor-pointer transition-colors",
            preview
              ? "border-border p-1"
              : "border-border hover:border-ring/50 bg-muted/20 hover:bg-muted/40 py-8"
          )}
        >
          {preview ? (
            isVideo ? (
              <video src={preview} controls muted className="w-full max-h-64 object-contain rounded-md" />
            ) : (
              <img src={preview} alt="preview" className="w-full max-h-64 object-contain rounded-md" />
            )
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="text-sm">Click to select photo or video</span>
              <span className="text-xs opacity-60">C2PA-verified media recommended</span>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*,video/*" className="sr-only" onChange={handleFileChange} />
        </label>
        {preview && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => { setPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
          >
            Remove
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <FieldLabel>Notes</FieldLabel>
        <Input ref={notesRef} type="text" placeholder="Optional notes" />
      </div>
      <Button className="w-full" disabled={busy} onClick={handleSubmit}>
        {uploading ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
        ) : isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
        ) : (
          "Submit →"
        )}
      </Button>
    </div>
  );
}

// ---- QueryCard ----

// Placeholder worker pubkey (future: Nostr key integration)
const WORKER_PUBKEY = "worker_ui_placeholder_pubkey";

function QueryCard({ query, onSubmitted }: { query: Query; onSubmitted?: (id: string) => void }) {
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
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <QueryTypeBadge query={query} />
            <span className="text-sm text-foreground truncate">
              {query.description}
            </span>
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
      </CardHeader>

      {open && (
        <CardContent className="px-4 pb-5 pt-4 border-t border-border space-y-5">
          {/* Nonce box */}
          {query.challenge_nonce && (
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg px-4 py-4">
              <p className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold mb-2">
                Challenge Nonce
              </p>
              <p className="font-mono text-5xl font-black text-amber-400 tracking-[0.4em] leading-none mb-3">
                {query.challenge_nonce}
              </p>
              <p className="text-sm text-foreground/80 leading-relaxed">
                {query.challenge_rule}
              </p>
            </div>
          )}

          {/* TLSNotary worker panel or photo submit form */}
          {tlsn && !submitted ? (
            <TlsnWorkerPanel query={query} onSubmit={mut.mutate} isPending={mut.isPending} />
          ) : !tlsn && !submitted ? (
            <div className="pt-1">
              <SubmitForm query={query} onSubmit={mut.mutate} isPending={mut.isPending} />
            </div>
          ) : null}

          {/* Inline result feedback with verification details */}
          {mut.isSuccess && (
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
              {mut.error.message || "Network error"}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---- VerificationPanel ----

function VerificationPanel({
  verification,
  preimage,
  paymentStatus,
  oracleId,
  htlc,
  attestations,
}: {
  verification?: VerificationDetail;
  preimage?: string | null;
  paymentStatus?: string;
  oracleId?: string | null;
  htlc?: HtlcSummary | null;
  attestations?: OracleAttestationRecord[] | null;
}) {
  const [copied, setCopied] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);

  if (!verification && !preimage) return null;

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatBody(raw: string): string {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  }

  return (
    <div className="space-y-3">
      {/* Checks */}
      {verification && verification.checks.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Checks</p>
          {verification.checks.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}

      {/* Failures */}
      {verification && verification.failures.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Failures</p>
          {verification.failures.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-red-400">
              <XCircle className="w-3 h-3 shrink-0" />
              <span>{f}</span>
            </div>
          ))}
        </div>
      )}

      {/* TLSNotary Verified Data */}
      {verification?.tlsn_verified && (
        <div className="bg-blue-950/20 border border-blue-900/30 rounded-lg px-3 py-2.5 space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-blue-400 font-semibold flex items-center gap-1">
            <Shield className="w-3 h-3" />
            TLSNotary Verified Data
          </p>
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Server:</span>
              <span className="text-foreground font-mono">{verification.tlsn_verified.server_name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Session:</span>
              <span className="text-foreground font-mono">
                {new Date(verification.tlsn_verified.session_timestamp * 1000).toLocaleString()}
              </span>
            </div>
          </div>
          {verification.tlsn_verified.revealed_body && (
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
                    {formatBody(verification.tlsn_verified.revealed_body)}
                  </code>
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* HTLC Info */}
      {(preimage || (htlc && htlc.verified_escrow_sats)) && (
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
      )}

      {/* Oracle Attestations (quorum) */}
      {attestations && attestations.length > 0 && (
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
      )}

      {/* Oracle ID (single oracle) */}
      {oracleId && !attestations?.length && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Oracle:</span>
          <span className="text-foreground font-mono text-[10px]">{oracleId}</span>
        </div>
      )}
    </div>
  );
}

// ---- ResultProofPanel ----

function ResultProofPanel({ query }: { query: Query }) {
  const result = query.result;
  const [extExpanded, setExtExpanded] = useState(false);
  const [tlsnExpanded, setTlsnExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  if (!result) return null;

  const hasAnyProof = (result.attachments?.length ?? 0) > 0
    || result.tlsn_attestation
    || result.tlsn_extension_result
    || result.notes
    || result.gps;

  if (!hasAnyProof) return null;

  function handleCopy(label: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  const apiOrigin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1">
        <Paperclip className="w-3 h-3" />
        Submitted Proof
      </p>

      {/* Photo / Video Attachments */}
      {result.attachments.length > 0 && (
        <div className="space-y-2">
          {result.attachments.map((att, i) => {
            const isImage = att.mime_type.startsWith("image/");
            const isVideo = att.mime_type.startsWith("video/");
            const previewUrl = `${apiOrigin}/queries/${query.id}/attachments/${i}/preview`;
            const viewUrl = `${apiOrigin}/queries/${query.id}/attachments/${i}`;
            return (
              <div key={att.id || i} className="bg-black/20 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <Image className="w-3 h-3 text-violet-400 shrink-0" />
                  <span className="text-foreground truncate">{att.filename || att.id}</span>
                  <span className="text-muted-foreground text-[10px]">{att.mime_type}</span>
                  {att.size_bytes != null && (
                    <span className="text-muted-foreground text-[10px]">
                      {att.size_bytes > 1024 * 1024
                        ? `${(att.size_bytes / (1024 * 1024)).toFixed(1)}MB`
                        : `${Math.round(att.size_bytes / 1024)}KB`}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/60">{att.storage_kind}</span>
                </div>
                {isImage && (
                  <a href={viewUrl} target="_blank" rel="noopener noreferrer">
                    <img
                      src={previewUrl}
                      alt={att.filename || "attachment"}
                      className="w-full max-h-48 object-contain rounded-md bg-black/30"
                      loading="lazy"
                    />
                  </a>
                )}
                {isVideo && (
                  <video src={viewUrl} controls muted className="w-full max-h-48 rounded-md" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* TLSNotary Presentation (base64) */}
      {result.tlsn_attestation && (
        <div className="bg-blue-950/20 border border-blue-900/30 rounded-lg px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-blue-400 font-semibold flex items-center gap-1">
              <Shield className="w-3 h-3" />
              TLSNotary Presentation
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {Math.round(result.tlsn_attestation.presentation.length * 0.75 / 1024)}KB
              </span>
              <button
                type="button"
                onClick={() => handleCopy("tlsn", result.tlsn_attestation!.presentation)}
                className="p-1 rounded hover:bg-white/10"
              >
                {copied === "tlsn" ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTlsnExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
          >
            {tlsnExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {tlsnExpanded ? "Hide" : "Show"} raw base64
          </button>
          {tlsnExpanded && (
            <pre className="bg-black/50 rounded-lg p-2 overflow-x-auto text-[10px] leading-relaxed max-h-32 overflow-y-auto break-all">
              <code className="text-blue-300 font-mono">{result.tlsn_attestation.presentation}</code>
            </pre>
          )}
        </div>
      )}

      {/* TLSNotary Extension Result */}
      {result.tlsn_extension_result != null ? (
        <div className="bg-blue-950/20 border border-blue-900/30 rounded-lg px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-blue-400 font-semibold flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              Extension Result
            </p>
            <button
              type="button"
              onClick={() => handleCopy("ext", JSON.stringify(result.tlsn_extension_result, null, 2))}
              className="p-1 rounded hover:bg-white/10"
            >
              {copied === "ext" ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setExtExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
          >
            {extExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {extExpanded ? "Hide" : "Show"} JSON
          </button>
          {extExpanded && (
            <pre className="bg-black/50 rounded-lg p-2 overflow-x-auto text-[11px] leading-relaxed max-h-48 overflow-y-auto">
              <code className="text-emerald-300 font-mono whitespace-pre">
                {JSON.stringify(result.tlsn_extension_result, null, 2)}
              </code>
            </pre>
          )}
        </div>
      ) : null}

      {/* GPS */}
      {result.gps && (
        <div className="flex items-center gap-2 text-xs">
          <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-muted-foreground">GPS:</span>
          <span className="text-foreground font-mono">{result.gps.lat.toFixed(6)}, {result.gps.lon.toFixed(6)}</span>
        </div>
      )}

      {/* Notes */}
      {result.notes && (
        <div className="flex items-start gap-2 text-xs">
          <FileText className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-foreground">{result.notes}</span>
        </div>
      )}
    </div>
  );
}

// ---- Status badge ----

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

// ---- MyResults ----

// ---- ClosedQueryCard (inline, no individual fetch needed) ----

function ClosedQueryCard({ query }: { query: Query }) {
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
            <span className="text-sm text-foreground truncate">
              {query.description}
            </span>
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

/** Fetches full detail only when the card is expanded. */
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

      <ResultProofPanel query={query} />
    </CardContent>
  );
}

// ---- ClosedQueryList ----

const OPEN_STATUSES = ["pending", "awaiting_quotes", "worker_selected", "processing"];

function ClosedQueryList() {
  const { data: allQueries = [] } = useQuery<Query[]>({
    queryKey: ["queries-all"],
    queryFn: (): Promise<Query[]> => apiFetch("/queries/all").then((r) => r.json()),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  const closed = allQueries.filter((q) => !OPEN_STATUSES.includes(q.status ?? ""));

  if (!closed.length) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
        Completed Queries
        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{closed.length}</span>
      </h2>
      <div className="flex flex-col gap-3">
        {closed.map((q) => (
          <ClosedQueryCard key={q.id} query={q} />
        ))}
      </div>
    </div>
  );
}

// ---- QueryList ----

function QueryList({ onSubmitted }: { onSubmitted?: (id: string) => void }) {
  const { data: queries = [], isError } = useQuery<Query[]>({
    queryKey: ["queries"],
    queryFn: (): Promise<Query[]> => apiFetch("/queries").then((r) => r.json()),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <AlertCircle className="w-8 h-8" />
        <p className="text-sm font-medium">Could not reach server</p>
        <p className="text-xs">Is the server running?</p>
      </div>
    );
  }

  if (!queries.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Clock className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          No pending queries
        </p>
        <p className="text-xs text-muted-foreground/60">
          Live real-world queries will appear here · checking every 3s
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {queries.map((query) => (
        <QueryCard key={query.id} query={query} onSubmitted={onSubmitted} />
      ))}
    </div>
  );
}

// ---- LogsPanel ----

interface LogEntry {
  service: string;
  message: string;
  ts: number;
}

const SERVICE_COLORS: Record<string, string> = {
  relay: "text-purple-400",
  blossom: "text-pink-400",
  "tlsn-verifier": "text-blue-400",
  bitcoind: "text-orange-400",
  "lnd-mint": "text-yellow-400",
  "lnd-user": "text-lime-400",
  "cashu-mint": "text-green-400",
  anchr: "text-cyan-400",
  docker: "text-zinc-400",
  system: "text-red-400",
};

const ALL_SERVICES = Object.keys(SERVICE_COLORS);

function LogsPanel() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // Connect/disconnect EventSource when panel opens/closes
  useEffect(() => {
    if (!open) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    const apiBase = typeof window !== "undefined" ? window.location.origin : "";
    const es = new EventSource(`${apiBase}/logs/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data) as LogEntry;
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // Reconnect is automatic with EventSource
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [open]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  function toggleService(svc: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(svc) ? next.delete(svc) : next.add(svc);
      return next;
    });
  }

  const filtered = hidden.size > 0 ? logs.filter((l) => !hidden.has(l.service)) : logs;

  // Count per service for badges
  const counts: Record<string, number> = {};
  for (const l of logs) counts[l.service] = (counts[l.service] || 0) + 1;
  const activeServices = Object.keys(counts).sort();

  return (
    <div className="border-t border-border bg-black/30">
      {/* Toggle bar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground">Container Logs</span>
          {logs.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60">{logs.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!open && activeServices.length > 0 && (
            <div className="flex items-center gap-1">
              {activeServices.slice(0, 5).map((svc) => (
                <span
                  key={svc}
                  className={cn("text-[9px] font-mono px-1 py-0.5 rounded bg-black/40", SERVICE_COLORS[svc] || "text-zinc-400")}
                >
                  {svc}
                </span>
              ))}
              {activeServices.length > 5 && (
                <span className="text-[9px] text-muted-foreground">+{activeServices.length - 5}</span>
              )}
            </div>
          )}
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-border">
          {/* Service filter chips */}
          <div className="px-4 py-2 flex items-center gap-1.5 flex-wrap border-b border-border/50">
            {(activeServices.length > 0 ? activeServices : ALL_SERVICES).map((svc) => (
              <button
                key={svc}
                type="button"
                onClick={() => toggleService(svc)}
                className={cn(
                  "text-[10px] font-mono px-1.5 py-0.5 rounded transition-opacity",
                  hidden.has(svc) ? "opacity-30 bg-black/20" : "opacity-100 bg-black/40",
                  SERVICE_COLORS[svc] || "text-zinc-400",
                )}
              >
                {svc}
                {counts[svc] ? ` (${counts[svc]})` : ""}
              </button>
            ))}
            {logs.length > 0 && (
              <button
                type="button"
                onClick={() => { setLogs([]); setHidden(new Set()); }}
                className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
              >
                Clear
              </button>
            )}
          </div>

          {/* Log output */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-64 overflow-y-auto overflow-x-hidden font-mono text-[11px] leading-relaxed px-4 py-2"
          >
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground/50 text-xs">
                {logs.length === 0 ? "Connecting to log stream..." : "All services filtered"}
              </div>
            ) : (
              filtered.map((entry, i) => (
                <div key={i} className="flex gap-2 hover:bg-white/[0.02] py-px">
                  <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0 w-16 text-right">
                    {new Date(entry.ts).toLocaleTimeString("en-GB", { hour12: false })}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 w-24 text-right truncate font-semibold",
                      SERVICE_COLORS[entry.service] || "text-zinc-400",
                    )}
                  >
                    {entry.service}
                  </span>
                  <span className="text-foreground/80 break-all">{entry.message}</span>
                </div>
              ))
            )}
          </div>

          {/* Scroll indicator */}
          {!autoScroll && (
            <div className="px-4 py-1 border-t border-border/50">
              <button
                type="button"
                onClick={() => {
                  setAutoScroll(true);
                  scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                }}
                className="text-[10px] text-blue-400 hover:text-blue-300"
              >
                ↓ Scroll to bottom
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- BalanceCard ----

interface BalanceData {
  role: string;
  pubkey: string;
  balance_sats: number;
  pending_sats: number;
  mint_url: string | null;
}

function BalanceCard() {
  const { data, isLoading } = useQuery<BalanceData>({
    queryKey: ["wallet-balance-worker"],
    queryFn: () =>
      apiFetch(`/wallet/balance?role=worker&pubkey=${WORKER_PUBKEY}`).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch balance");
        return r.json();
      }),
    refetchInterval: 5000,
  });

  return (
    <div className="mb-6 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Earned Balance
          </span>
        </div>
        {data?.pending_sats ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Pending</span>
            <span className="text-xs font-semibold text-amber-400/70">
              {data.pending_sats} sats
            </span>
          </div>
        ) : null}
      </div>
      <p className="text-2xl font-bold text-amber-400 mt-1">
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <>{data?.balance_sats ?? 0} sats</>
        )}
      </p>
    </div>
  );
}

// ---- App ----

export default function App() {
  const queryClient = useQueryClient();

  const { isFetching } = useQuery<Query[]>({
    queryKey: ["queries"],
    queryFn: (): Promise<Query[]> => apiFetch("/queries").then((r) => r.json()),
    staleTime: 2000,
  });

  const handleSubmitted = useCallback((_id: string) => {
    // Invalidate all-queries so ClosedQueryList picks up the new result
    queryClient.invalidateQueries({ queryKey: ["queries-all"] });
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 max-w-2xl mx-auto px-4 py-10 w-full">
        <header className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">
                Anchr
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                Earn sats by proving ground truth
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              {isFetching ? (
                <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              <span className="text-[11px] text-muted-foreground">live</span>
            </div>
          </div>
        </header>

        <BalanceCard />

        <div className="space-y-8">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-4">Open Queries</h2>
            <QueryList onSubmitted={handleSubmitted} />
          </div>

          <ClosedQueryList />
        </div>
      </div>

      <LogsPanel />
    </div>
  );
}
