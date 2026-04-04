import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Image,
  MapPin,
  Paperclip,
  Shield,
} from "lucide-react";
import React, { useState } from "react";

export { VerificationPanel } from "./VerificationPanel";
export type { VerificationPanelProps } from "./VerificationPanel";

// ---- Types ----

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

export interface ResultProofPanelProps {
  queryId: string;
  result?: QueryResultData;
}

// ---- Sub-components ----

function AttachmentItem({
  att,
  index,
  queryId,
  apiOrigin,
}: {
  att: QueryResultAttachment;
  index: number;
  queryId: string;
  apiOrigin: string;
}) {
  const isImage = att.mime_type.startsWith("image/");
  const isVideo = att.mime_type.startsWith("video/");
  const previewUrl = `${apiOrigin}/queries/${queryId}/attachments/${index}/preview`;
  const viewUrl = `${apiOrigin}/queries/${queryId}/attachments/${index}`;

  return (
    <div className="bg-black/20 rounded-lg p-2 space-y-1.5">
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
}

function TlsnPresentationBlock({ presentation }: { presentation: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function handleCopy(label: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="bg-blue-950/20 border border-blue-900/30 rounded-lg px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-blue-400 font-semibold flex items-center gap-1">
          <Shield className="w-3 h-3" />
          TLSNotary Presentation
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {Math.round(presentation.length * 0.75 / 1024)}KB
          </span>
          <button
            type="button"
            onClick={() => handleCopy("tlsn", presentation)}
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
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {expanded ? "Hide" : "Show"} raw base64
      </button>
      {expanded && (
        <pre className="bg-black/50 rounded-lg p-2 overflow-x-auto text-[10px] leading-relaxed max-h-32 overflow-y-auto break-all">
          <code className="text-blue-300 font-mono">{presentation}</code>
        </pre>
      )}
    </div>
  );
}

function ExtensionResultBlock({ extensionResult }: { extensionResult: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function handleCopy(label: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="bg-blue-950/20 border border-blue-900/30 rounded-lg px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-blue-400 font-semibold flex items-center gap-1">
          <ExternalLink className="w-3 h-3" />
          Extension Result
        </p>
        <button
          type="button"
          onClick={() => handleCopy("ext", JSON.stringify(extensionResult, null, 2))}
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
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {expanded ? "Hide" : "Show"} JSON
      </button>
      {expanded && (
        <pre className="bg-black/50 rounded-lg p-2 overflow-x-auto text-[11px] leading-relaxed max-h-48 overflow-y-auto">
          <code className="text-emerald-300 font-mono whitespace-pre">
            {JSON.stringify(extensionResult, null, 2)}
          </code>
        </pre>
      )}
    </div>
  );
}

// ---- Main component ----

export function ResultProofPanel({ queryId, result }: ResultProofPanelProps) {
  if (!result) return null;

  const hasAnyProof = (result.attachments?.length ?? 0) > 0
    || result.tlsn_attestation
    || result.tlsn_extension_result
    || result.notes
    || result.gps;

  if (!hasAnyProof) return null;

  const apiOrigin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1">
        <Paperclip className="w-3 h-3" />
        Submitted Proof
      </p>

      {result.attachments.length > 0 && (
        <div className="space-y-2">
          {result.attachments.map((att, i) => (
            <AttachmentItem key={att.id || i} att={att} index={i} queryId={queryId} apiOrigin={apiOrigin} />
          ))}
        </div>
      )}

      {result.tlsn_attestation && (
        <TlsnPresentationBlock presentation={result.tlsn_attestation.presentation} />
      )}

      {result.tlsn_extension_result != null ? (
        <ExtensionResultBlock extensionResult={result.tlsn_extension_result} />
      ) : null}

      {result.gps && (
        <div className="flex items-center gap-2 text-xs">
          <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-muted-foreground">GPS:</span>
          <span className="text-foreground font-mono">{result.gps.lat.toFixed(6)}, {result.gps.lon.toFixed(6)}</span>
        </div>
      )}

      {result.notes && (
        <div className="flex items-start gap-2 text-xs">
          <FileText className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-foreground">{result.notes}</span>
        </div>
      )}
    </div>
  );
}
