import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
} from "lucide-react";
import React, { useRef, useState } from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "./components/ui/card";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/utils";
import type { AttachmentRef, BlossomKeyMap, BlossomKeyMaterial, QueryType } from "../types";

// ---- Types ----

interface Bounty {
  amount_sats: number;
}

interface UploadResponse {
  ok: boolean;
  attachment?: AttachmentRef;
  encryption?: BlossomKeyMaterial;
  attachment_ref?: string;
  url?: string;
  error?: string;
}

interface Query {
  id: string;
  type: QueryType;
  params: Record<string, unknown>;
  challenge_nonce: string;
  challenge_rule: string;
  expires_at: number;
  expires_in_seconds: number;
  bounty?: Bounty | null;
}

interface SubmitResponse {
  ok: boolean;
  message: string;
  verification?: { failures: string[] };
}

// ---- Time helpers ----

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

// ---- Query type badge config ----

const QUERY_TYPE_CONFIG: Record<QueryType, { label: string; className: string }> =
  {
    photo_proof: {
      label: "Photo Proof",
      className:
        "bg-blue-950 text-blue-400 border-blue-800 hover:bg-blue-950",
    },
    store_status: {
      label: "Store Status",
      className:
        "bg-emerald-950 text-emerald-400 border-emerald-800 hover:bg-emerald-950",
    },
    webpage_field: {
      label: "Webpage Field",
      className:
        "bg-purple-950 text-purple-400 border-purple-800 hover:bg-purple-950",
    },
  };

function QueryBadge({ type }: { type: QueryType }) {
  const { label, className } = QUERY_TYPE_CONFIG[type];
  return (
    <Badge variant="outline" className={cn("text-[11px] font-semibold", className)}>
      {label}
    </Badge>
  );
}

// ---- Submit forms ----

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {children}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function StoreStatusForm({
  query,
  onSubmit,
  isPending,
}: {
  query: Query;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [status, setStatus] = useState("open");
  const notesRef = useRef<HTMLTextAreaElement>(null);
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
        const res = await fetch(`/queries/${query.id}/upload`, {
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
      type: query.type,
      status,
      attachments,
      notes: notesRef.current?.value ?? "",
      ...(Object.keys(encryptionKeys).length > 0 ? { encryption_keys: encryptionKeys } : {}),
    });
  }

  const busy = isPending || uploading;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <FieldLabel required>Store Status</FieldLabel>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open — currently open</SelectItem>
            <SelectItem value="closed">Closed — currently closed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {/* Photo upload */}
      <div className="space-y-1.5">
        <FieldLabel>Photo / Video</FieldLabel>
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
              <span className="text-xs opacity-60">Photo evidence strengthens verification</span>
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
        <Textarea
          ref={notesRef}
          rows={2}
          placeholder="補足メモ（任意）"
          className="resize-none"
        />
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

function WebpageFieldForm({
  query,
  onSubmit,
  isPending,
}: {
  query: Query;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const answerRef = useRef<HTMLInputElement>(null);
  const proofRef = useRef<HTMLTextAreaElement>(null);
  const anchorWord = String(query.params["anchor_word"] ?? "");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <FieldLabel required>Answer</FieldLabel>
        <Input ref={answerRef} type="text" placeholder="e.g. ¥1,980" />
      </div>
      <div className="space-y-1.5">
        <FieldLabel required>
          Proof text — near keyword{" "}
          <span className="font-mono font-semibold text-purple-400">
            "{anchorWord}"
          </span>
        </FieldLabel>
        <Textarea
          ref={proofRef}
          rows={3}
          placeholder="anchorワードの近傍テキスト..."
          className="resize-none"
        />
      </div>
      <Button
        className="w-full"
        disabled={isPending}
        onClick={() =>
          onSubmit({
            type: query.type,
            answer: answerRef.current?.value ?? "",
            proof_text: proofRef.current?.value ?? "",
          })
        }
      >
        {isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Submitting…
          </>
        ) : (
          "Submit →"
        )}
      </Button>
    </div>
  );
}

function PhotoProofForm({
  query,
  onSubmit,
  isPending,
}: {
  query: Query;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
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
        const res = await fetch(`/queries/${query.id}/upload`, {
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
        } else {
          const attachmentRef = data.attachment_ref ?? data.url;
          if (!attachmentRef) throw new Error(data.error ?? "Upload failed");
          attachments = [{
            id: attachmentRef.split("/").filter(Boolean).pop() ?? "attachment",
            uri: attachmentRef,
            mime_type: file.type || "application/octet-stream",
            storage_kind: attachmentRef.startsWith("/uploads/") ? "local" : "external",
            route_path: attachmentRef.startsWith("/uploads/") ? attachmentRef : undefined,
          }];
        }
      } finally {
        setUploading(false);
      }
    }
    onSubmit({
      type: query.type,
      text_answer: textRef.current?.value ?? "",
      attachments,
      notes: notesRef.current?.value ?? "",
      ...(Object.keys(encryptionKeys).length > 0 ? { encryption_keys: encryptionKeys } : {}),
    });
  }

  const busy = isPending || uploading;
  const hasPhoto = Boolean(fileRef.current?.files?.[0] || preview);

  return (
    <div className="space-y-4">
      {/* Photo/video upload area */}
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
              <video
                src={preview}
                controls
                muted
                className="w-full max-h-64 object-contain rounded-md"
              />
            ) : (
              <img
                src={preview}
                alt="preview"
                className="w-full max-h-64 object-contain rounded-md"
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="text-sm">Click to select photo or video</span>
              <span className="text-xs opacity-60">JPG, PNG, GIF, WebP, HEIC, MP4, MOV, WebM</span>
              <span className="text-xs opacity-60">At least one file is required</span>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            className="sr-only"
            onChange={handleFileChange}
          />
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
        <FieldLabel>Description</FieldLabel>
        <Textarea
          ref={textRef}
          rows={3}
          placeholder="見たものを説明してください（任意）"
          className="resize-none"
        />
      </div>
      <div className="space-y-1.5">
        <FieldLabel>Notes</FieldLabel>
        <Input ref={notesRef} type="text" placeholder="補足（任意）" />
      </div>
      <Button className="w-full" disabled={busy || !hasPhoto} onClick={handleSubmit}>
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

function QueryCard({ query }: { query: Query }) {
  const [open, setOpen] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [, setTick] = useState(0);

  React.useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const mut = useMutation<SubmitResponse, Error, Record<string, unknown>>({
    mutationFn: async (body) => {
      const r = await fetch(`/queries/${query.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok && r.status >= 500)
        throw new Error(`Server error ${r.status}`);
      return r.json() as Promise<SubmitResponse>;
    },
  });

  const submitted = mut.isSuccess && mut.data.ok;

  return (
    <Card className={cn("overflow-hidden py-0 gap-0", open && "border-border/80")}>
      {/* Header */}
      <CardHeader
        className="px-4 py-3.5 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <QueryBadge type={query.type} />
            <span className="text-[11px] text-muted-foreground font-mono truncate">
              {query.id}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {query.bounty && query.bounty.amount_sats > 0 && (
              <span className="text-xs font-semibold text-amber-400">
                {query.bounty.amount_sats} sats
              </span>
            )}
            <span
              className={cn(
                "text-xs flex items-center gap-1",
                timerClasses(query.expires_at)
              )}
            >
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

      {/* Body */}
      {open && (
        <CardContent className="px-4 pb-5 pt-4 border-t border-border space-y-5">
          {/* Nonce box */}
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

          {/* Params collapsible */}
          <div>
            <button
              onClick={() => setShowParams((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              {showParams ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              Query parameters
            </button>
            {showParams && (
              <pre className="mt-2 text-[11px] text-muted-foreground bg-background border border-border rounded-lg p-3 overflow-x-auto leading-relaxed">
                {JSON.stringify(query.params, null, 2)}
              </pre>
            )}
          </div>

          {/* Submission form */}
          {!submitted && (
            <div className="pt-1">
              {query.type === "store_status" && (
                <StoreStatusForm
                  query={query}
                  onSubmit={mut.mutate}
                  isPending={mut.isPending}
                />
              )}
              {query.type === "webpage_field" && (
                <WebpageFieldForm
                  query={query}
                  onSubmit={mut.mutate}
                  isPending={mut.isPending}
                />
              )}
              {query.type === "photo_proof" && (
                <PhotoProofForm
                  query={query}
                  onSubmit={mut.mutate}
                  isPending={mut.isPending}
                />
              )}
            </div>
          )}

          {/* Result feedback */}
          {mut.isSuccess && (
            <div
              className={cn(
                "flex items-start gap-3 p-3.5 rounded-lg text-sm leading-relaxed",
                mut.data.ok
                  ? "bg-emerald-950/50 border border-emerald-800/60 text-emerald-400"
                  : "bg-red-950/50 border border-red-900/60 text-red-400"
              )}
            >
              {mut.data.ok ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              <div className="space-y-1">
                <p>{mut.data.message}</p>
                {(mut.data.verification?.failures?.length ?? 0) > 0 && (
                  <p className="text-xs opacity-70">
                    {mut.data.verification!.failures.join(", ")}
                  </p>
                )}
              </div>
            </div>
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

// ---- QueryList ----

function QueryList() {
  const { data: queries = [], isError } = useQuery<Query[]>({
    queryKey: ["queries"],
    queryFn: (): Promise<Query[]> => fetch("/queries").then((r) => r.json()),
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
        <QueryCard key={query.id} query={query} />
      ))}
    </div>
  );
}

// ---- App ----

export default function App() {
  const { isFetching } = useQuery<Query[]>({
    queryKey: ["queries"],
    queryFn: (): Promise<Query[]> => fetch("/queries").then((r) => r.json()),
    staleTime: 2000,
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">
                Anchr
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                Ground truth from the street
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

        <QueryList />
      </div>
    </div>
  );
}
