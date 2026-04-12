import { Loader2 } from "lucide-react";
import React, { useRef, useState } from "react";
import { apiFetch } from "./api-config";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { cn } from "./lib/utils";
import type { AttachmentRef, BlossomKeyMap, BlossomKeyMaterial } from "../domain/types";

interface UploadResponse {
  ok: boolean;
  attachment?: AttachmentRef;
  encryption?: BlossomKeyMaterial;
  error?: string;
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {children}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function FileSelector({
  fileRef,
  preview,
  isVideo,
  onFileChange,
  onRemove,
}: {
  fileRef: React.RefObject<HTMLInputElement | null>;
  preview: string | null;
  isVideo: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
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
        {/* preview is always a blob: URL from URL.createObjectURL(file) — safe to use as src */}
        {preview ? (
          isVideo ? (
            // codeql[js/xss-through-dom] — preview is a blob URL from URL.createObjectURL, not user-controlled HTML
            <video src={preview} controls muted className="w-full max-h-64 object-contain rounded-md" />
          ) : (
            // codeql[js/xss-through-dom] — preview is a blob URL from URL.createObjectURL, not user-controlled HTML
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
        <input ref={fileRef} type="file" accept="image/*,video/*" className="sr-only" onChange={onFileChange} />
      </label>
      {preview && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={onRemove}
        >
          Remove
        </button>
      )}
    </div>
  );
}

export function SubmitForm({
  queryId,
  onSubmit,
  isPending,
}: {
  queryId: string;
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
        const res = await apiFetch(`/queries/${queryId}/upload`, {
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
      <FileSelector
        fileRef={fileRef}
        preview={preview}
        isVideo={isVideo}
        onFileChange={handleFileChange}
        onRemove={() => { setPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
      />

      <div className="space-y-1.5">
        <FieldLabel>Notes</FieldLabel>
        <Input ref={notesRef} type="text" placeholder="Optional notes" />
      </div>
      <Button className="w-full" disabled={busy} onClick={handleSubmit}>
        {uploading ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Uploading{"\u2026"}</>
        ) : isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Submitting{"\u2026"}</>
        ) : (
          "Submit \u2192"
        )}
      </Button>
    </div>
  );
}
