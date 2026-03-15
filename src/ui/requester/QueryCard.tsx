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
import React, { useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { cn } from "../lib/utils";

interface Bounty {
  amount_sats: number;
}

interface HtlcSummary {
  hash: string;
  oracle_pubkey: string;
  worker_pubkey: string | null;
  locktime: number;
}

interface BlossomKeyMaterial {
  encrypt_key: string;
  encrypt_iv: string;
}

interface QuerySummary {
  id: string;
  status: string;
  description: string;
  location_hint: string | null;
  bounty: Bounty | null;
  challenge_nonce: string;
  challenge_rule: string;
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

interface QueryDetail extends QuerySummary {
  created_at: number;
  submitted_at?: number;
  payment_status: string;
  result?: {
    attachments: AttachmentInfo[];
    notes?: string;
  };
  verification?: {
    passed: boolean;
    checks: string[];
    failures: string[];
  };
  blossom_keys?: Record<string, BlossomKeyMaterial> | null;
}

// --- AES-256-GCM decryption (Web Crypto API) ---

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function decryptBlob(
  encrypted: ArrayBuffer,
  keyHex: string,
  ivHex: string,
): Promise<ArrayBuffer> {
  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const ivBytes = hexToBytes(ivHex);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes.buffer as ArrayBuffer },
    key,
    encrypted,
  );
}

// --- Decrypted image component ---

function DecryptedImage({
  attachment,
  keyMaterial,
}: {
  attachment: AttachmentInfo;
  keyMaterial: BlossomKeyMaterial;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revoked = false;
    (async () => {
      try {
        const res = await fetch(attachment.uri);
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        const encrypted = await res.arrayBuffer();
        const decrypted = await decryptBlob(encrypted, keyMaterial.encrypt_key, keyMaterial.encrypt_iv);
        if (revoked) return;
        const blob = new Blob([decrypted], { type: attachment.mime_type });
        setObjectUrl(URL.createObjectURL(blob));
      } catch (e) {
        if (!revoked) setError((e as Error).message);
      } finally {
        if (!revoked) setLoading(false);
      }
    })();
    return () => {
      revoked = true;
      setObjectUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [attachment.uri, keyMaterial.encrypt_key, keyMaterial.encrypt_iv]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 rounded-md border bg-muted/20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md border bg-red-50 text-xs text-red-600">
        <XCircle className="w-4 h-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (!objectUrl) return null;

  const isVideo = attachment.mime_type.startsWith("video/");
  return isVideo ? (
    <video src={objectUrl} controls muted className="w-full rounded-md border" />
  ) : (
    <img src={objectUrl} alt="decrypted" className="w-full rounded-md border" />
  );
}

// --- Status config ---

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "受付中", variant: "secondary" },
  awaiting_quotes: { label: "見積待ち", variant: "secondary" },
  worker_selected: { label: "ワーカー決定", variant: "default" },
  processing: { label: "処理中", variant: "default" },
  verifying: { label: "検証中", variant: "default" },
  submitted: { label: "提出済み", variant: "default" },
  approved: { label: "承認", variant: "default" },
  rejected: { label: "却下", variant: "destructive" },
  expired: { label: "期限切れ", variant: "outline" },
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}

function timeLeft(expiresAt: number): string {
  const s = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  if (s === 0) return "期限切れ";
  if (s < 60) return `残り${s}秒`;
  return `残り${Math.floor(s / 60)}分`;
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

// --- QueryCard ---

export function QueryCard({ query }: { query: QuerySummary }) {
  const [open, setOpen] = useState(false);
  const config = STATUS_CONFIG[query.status] ?? { label: query.status, variant: "outline" as const };
  const isActive = ["pending", "awaiting_quotes", "worker_selected", "processing", "verifying"].includes(query.status);

  const { data: detail } = useQuery<QueryDetail>({
    queryKey: ["query-detail", query.id],
    queryFn: () => fetch(`/queries/${query.id}`).then((r) => r.json()),
    enabled: open,
    refetchInterval: open && isActive ? 3000 : false,
  });

  const blossomKeys = detail?.blossom_keys;

  return (
    <Card className={cn("overflow-hidden py-0 gap-0 transition-shadow", open && "shadow-sm")}>
      <CardHeader
        className="px-4 py-3.5 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <StatusIcon status={query.status} />
            <span className="text-sm text-foreground truncate">{query.description}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {query.bounty && query.bounty.amount_sats > 0 && (
              <span className="text-xs font-semibold text-amber-500">
                {query.bounty.amount_sats} sats
              </span>
            )}
            <Badge variant={config.variant} className="text-[10px]">
              {config.label}
            </Badge>
            {open ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="px-4 pb-4 pt-3 border-t space-y-4">
          {/* Meta */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{timeAgo(detail?.created_at ?? Date.now())}</span>
            {query.location_hint && <span>{query.location_hint}</span>}
            {isActive && <span className="text-amber-500">{timeLeft(query.expires_at)}</span>}
            {query.quotes_count > 0 && (
              <span>{query.quotes_count}件の見積もり</span>
            )}
          </div>

          {/* Challenge */}
          <div className="rounded-lg border bg-muted/30 px-3 py-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
              Challenge Nonce
            </p>
            <p className="font-mono text-3xl font-black tracking-[0.3em] leading-none mb-2">
              {query.challenge_nonce}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {query.challenge_rule}
            </p>
          </div>

          {/* HTLC info */}
          {query.htlc && (
            <div className="rounded-lg border bg-blue-50 px-3 py-3 space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-blue-600 font-semibold">HTLC Escrow</p>
              <p className="text-xs text-muted-foreground font-mono truncate">Hash: {query.htlc.hash}</p>
              {query.htlc.worker_pubkey && (
                <p className="text-xs text-muted-foreground font-mono truncate">Worker: {query.htlc.worker_pubkey}</p>
              )}
            </div>
          )}

          {/* Payment status */}
          {detail?.payment_status && detail.payment_status !== "none" && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">支払い:</span>
              <Badge variant="outline" className="text-[10px]">
                {detail.payment_status}
              </Badge>
            </div>
          )}

          {/* Verification result */}
          {detail?.verification && (
            <div className={cn(
              "rounded-lg border px-3 py-3",
              detail.verification.passed
                ? "bg-emerald-50 border-emerald-200"
                : "bg-red-50 border-red-200",
            )}>
              <div className="flex items-center gap-2 mb-1">
                {detail.verification.passed
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <XCircle className="w-4 h-4 text-red-500" />
                }
                <span className={cn("text-sm font-medium", detail.verification.passed ? "text-emerald-700" : "text-red-700")}>
                  {detail.verification.passed ? "検証OK" : "検証NG"}
                </span>
              </div>
              {detail.verification.checks.length > 0 && (
                <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  {detail.verification.checks.map((c, i) => (
                    <li key={i}>{detail.verification!.passed ? "\u2713" : ""} {c}</li>
                  ))}
                </ul>
              )}
              {detail.verification.failures.length > 0 && (
                <ul className="text-xs text-red-600 mt-1 space-y-0.5">
                  {detail.verification.failures.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Decrypted attachments */}
          {detail?.result?.attachments && detail.result.attachments.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" />
                添付ファイル ({detail.result.attachments.length})
              </p>
              {detail.result.attachments.map((att) => {
                const km = blossomKeys?.[att.id];
                if (km) {
                  return <DecryptedImage key={att.id} attachment={att} keyMaterial={km} />;
                }
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
              {detail.result.notes && (
                <p className="text-xs text-muted-foreground">{detail.result.notes}</p>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
