/**
 * Blossom client for content-addressed blob storage.
 *
 * Blossom (BUD-01~06) stores blobs addressed by SHA-256 hash.
 * Any Blossom server can serve the same blob — content is portable.
 *
 * For Anchr, we:
 * 1. Encrypt caller-sanitized bytes with a random AES-256-GCM key
 * 2. Upload the encrypted blob to Blossom
 * 3. Share hash + decryption key via NIP-44 encrypted Nostr event
 *
 * Result: Blossom server sees only encrypted bytes. Content is opaque.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { type EventTemplate, finalizeEvent } from "nostr-tools";

import { getLogger } from "../internal/runtime/logger.ts";
import {
  type AttachmentRuntimeConfig,
  getAttachmentConfig,
} from "../internal/runtime/config.ts";
const log = getLogger(["anchr", "blossom"]);

export interface BlossomConfig {
  servers: string[];
}

/**
 * Minimal identity shape needed to sign BUD-02 upload-auth events.
 * Structurally compatible with `NostrIdentity` from the host.
 */
export interface BlossomUploadIdentity {
  secretKey: Uint8Array;
}

export interface BlossomConfigOptions {
  config?: AttachmentRuntimeConfig;
}

export function getBlossomConfig(
  options?: BlossomConfigOptions,
): BlossomConfig | null {
  const urls = (options?.config ?? getAttachmentConfig()).blossomServers;
  if (!urls || urls.length === 0) return null;
  return { servers: urls };
}

export function isBlossomEnabled(options?: BlossomConfigOptions): boolean {
  return getBlossomConfig(options) !== null;
}

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

// BUD-02: Blossom servers require a signed Nostr event for upload authorization.
function buildAuthEvent(
  identity: BlossomUploadIdentity,
  hash: string,
  serverEndpoint: string,
): string {
  const template: EventTemplate = {
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", "upload"],
      ["x", hash],
      ["expiration", String(Math.floor(Date.now() / 1000) + 300)],
    ],
    content: `Upload ${hash} to ${serverEndpoint}`,
  };

  const event = finalizeEvent(template, identity.secretKey);
  return btoa(JSON.stringify(event));
}

export interface BlossomUploadResult {
  hash: string;
  urls: string[];
  encryptKey: string;
  encryptIv: string;
  sizeBytes: number;
}

/**
 * Transport options for the Blossom HTTP touchpoints. The relay-only
 * anonymity guarantee (INV-08) does not cover these calls — operators who
 * need IP-level anonymity inject a proxy-routed `fetchImpl` (e.g. SOCKS5 /
 * Tor) here instead of the global fetch.
 */
export interface BlossomTransportOptions {
  fetchImpl?: typeof fetch;
  config?: AttachmentRuntimeConfig;
}

export async function uploadToBlossom(
  data: Uint8Array,
  identity: BlossomUploadIdentity,
  servers?: string[],
  transport?: BlossomTransportOptions,
): Promise<BlossomUploadResult | null> {
  const config = getBlossomConfig({ config: transport?.config });
  const urls = servers ?? config?.servers;
  if (!urls || urls.length === 0) return null;
  const fetchImpl = transport?.fetchImpl ?? fetch;

  const { encrypted, key, iv } = await encryptBlob(data);

  const hash = bytesToHex(sha256(encrypted));

  const successUrls: string[] = [];

  await Promise.allSettled(
    urls.map(async (serverEndpoint) => {
      const authToken = buildAuthEvent(identity, hash, serverEndpoint);

      const response = await fetchImpl(`${serverEndpoint}/upload`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Authorization": `Nostr ${authToken}`,
        },
        body: encrypted.buffer as ArrayBuffer,
      });

      await response.body?.cancel();
      if (response.ok) {
        successUrls.push(`${serverEndpoint}/${hash}`);
      } else {
        log.error(`Upload to ${serverEndpoint} failed: ${response.status}`);
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

export async function downloadFromBlossom(
  hash: string,
  encryptKey: string,
  encryptIv: string,
  servers?: string[],
  options?: {
    maxRetries?: number;
    retryDelayMs?: number;
  } & BlossomTransportOptions,
): Promise<Uint8Array | null> {
  const config = getBlossomConfig({ config: options?.config });
  const urls = servers ?? config?.servers;
  if (!urls || urls.length === 0) return null;

  const maxRetries = options?.maxRetries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 5000;
  const fetchImpl = options?.fetchImpl ?? fetch;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    for (const serverEndpoint of urls) {
      try {
        const response = await fetchImpl(`${serverEndpoint}/${hash}`);
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
      log.warn(
        `Download attempt ${attempt}/${maxRetries} failed for ${hash}, retrying in ${retryDelayMs}ms...`,
      );
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  log.error(`All ${maxRetries} download attempts failed for ${hash}`);
  return null;
}
