import { Loader2, XCircle } from "lucide-react";
import React, { useEffect, useState } from "react";

interface AttachmentInfo {
  id: string;
  uri: string;
  mime_type: string;
  storage_kind?: string;
}

interface BlossomKeyMaterial {
  encrypt_key: string;
  encrypt_iv: string;
}

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

export function DecryptedImage({
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
      <div className="flex items-center gap-2 p-3 rounded-md border bg-red-50 text-xs text-red-400">
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
