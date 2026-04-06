/**
 * Blossom client for content-addressed blob storage.
 *
 * Blossom (BUD-01~06) stores blobs addressed by SHA-256 hash.
 * Any Blossom server can serve the same blob — content is portable.
 *
 * For Anchr, we:
 * 1. Strip EXIF from the image
 * 2. Encrypt with a random AES-256-GCM key
 * 3. Upload the encrypted blob to Blossom
 * 4. Share hash + decryption key via NIP-44 encrypted Nostr event
 *
 * Result: Blossom server sees only encrypted bytes. Content is opaque.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { finalizeEvent, type EventTemplate } from "nostr-tools";
import type { NostrIdentity } from "../nostr/identity";

export interface BlossomConfig {
  serverUrls: string[];
}

export function getBlossomConfig(): BlossomConfig | null {
  const urls = process.env.BLOSSOM_SERVERS?.split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  if (!urls || urls.length === 0) return null;
  return { serverUrls: urls };
}

export function isBlossomEnabled(): boolean {
  return getBlossomConfig() !== null;
}

/**
 * Encrypt data with AES-256-GCM. Returns encrypted buffer and key.
 */
export async function encryptBlob(data: Uint8Array): Promise<{
  encrypted: Uint8Array;
  key: Uint8Array;
  iv: Uint8Array;
}> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    data.buffer as ArrayBuffer,
  );

  return {
    encrypted: new Uint8Array(encrypted),
    key,
    iv,
  };
}

/**
 * Decrypt AES-256-GCM encrypted data.
 */
export async function decryptBlob(
  encrypted: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    encrypted.buffer as ArrayBuffer,
  );

  return new Uint8Array(decrypted);
}

/**
 * Build a Blossom authorization event (BUD-02).
 * Blossom servers require a signed Nostr event for upload authorization.
 */
function buildAuthEvent(
  identity: NostrIdentity,
  hash: string,
  serverUrl: string,
): string {
  const template: EventTemplate = {
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", "upload"],
      ["x", hash],
      ["expiration", String(Math.floor(Date.now() / 1000) + 300)],
    ],
    content: `Upload ${hash} to ${serverUrl}`,
  };

  const event = finalizeEvent(template, identity.secretKey);
  return btoa(JSON.stringify(event));
}

export interface BlossomUploadResult {
  hash: string;
  urls: string[];
  encryptKey: string; // hex-encoded AES key
  encryptIv: string;  // hex-encoded IV
  sizeBytes: number;
}

/**
 * Upload an encrypted blob to Blossom servers.
 *
 * 1. Encrypt the data with AES-256-GCM
 * 2. Compute SHA-256 hash of the encrypted blob
 * 3. Upload to all configured Blossom servers
 * 4. Return hash + decryption key
 */
export async function uploadToBlossom(
  data: Uint8Array,
  identity: NostrIdentity,
  serverUrls?: string[],
): Promise<BlossomUploadResult | null> {
  const config = getBlossomConfig();
  const urls = serverUrls ?? config?.serverUrls;
  if (!urls || urls.length === 0) return null;

  // Encrypt
  const { encrypted, key, iv } = await encryptBlob(data);

  // Hash the encrypted blob
  const hash = bytesToHex(sha256(encrypted));

  // Upload to all servers
  const successUrls: string[] = [];

  await Promise.allSettled(
    urls.map(async (serverUrl) => {
      const authToken = buildAuthEvent(identity, hash, serverUrl);

      const response = await fetch(`${serverUrl}/upload`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Authorization": `Nostr ${authToken}`,
        },
        body: encrypted.buffer as ArrayBuffer,
      });

      await response.body?.cancel();
      if (response.ok) {
        successUrls.push(`${serverUrl}/${hash}`);
      } else {
        console.error(
          `[blossom] Upload to ${serverUrl} failed: ${response.status}`,
        );
      }
    }),
  );

  if (successUrls.length === 0) return null;

  return {
    hash,
    urls: successUrls,
    encryptKey: bytesToHex(key),
    encryptIv: bytesToHex(iv),
    sizeBytes: encrypted.length,
  };
}

/**
 * Download and decrypt a blob from Blossom servers.
 *
 * Retries the entire server list up to `maxRetries` times (default 3)
 * with a delay of `retryDelayMs` ms (default 5000) between attempts.
 */
export async function downloadFromBlossom(
  hash: string,
  encryptKey: string,
  encryptIv: string,
  serverUrls?: string[],
  options?: { maxRetries?: number; retryDelayMs?: number },
): Promise<Uint8Array | null> {
  const config = getBlossomConfig();
  const urls = serverUrls ?? config?.serverUrls;
  if (!urls || urls.length === 0) return null;

  const maxRetries = options?.maxRetries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 5000;

  const { hexToBytes } = await import("@noble/hashes/utils.js");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Try each server until we get the blob
    for (const serverUrl of urls) {
      try {
        const response = await fetch(`${serverUrl}/${hash}`);
        if (!response.ok) continue;

        const encrypted = new Uint8Array(await response.arrayBuffer());
        const key = hexToBytes(encryptKey);
        const iv = hexToBytes(encryptIv);

        return await decryptBlob(encrypted, key, iv);
      } catch {
        continue;
      }
    }

    if (attempt < maxRetries) {
      console.warn(
        `[blossom] Download attempt ${attempt}/${maxRetries} failed for ${hash}, retrying in ${retryDelayMs}ms...`,
      );
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  console.error(
    `[blossom] All ${maxRetries} download attempts failed for ${hash}`,
  );
  return null;
}
