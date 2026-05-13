import { join } from "node:path";
import { moduleDir } from "@anchr/core-runtime/mod";

function readNumberEnv(name: string, fallback: number): number {
  const value = Deno.env.get(name);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readStringListEnv(...names: string[]): string[] {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (!value) continue;
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export interface RuntimeConfig {
  httpApiPort: number;
  querySweepIntervalMs: number;
  previewMaxDimension: number;
  previewJpegQuality: number;
  httpApiKeys: string[];
  anthropicApiKey?: string;
  aiContentCheckEnabled: boolean;
  /** Trusted Oracle pubkeys for Worker whitelist (from TRUSTED_ORACLE_PUBKEYS env). */
  trustedOraclePubkeys: string[];
  /** TLSNotary Verifier Server URL (served to workers). */
  tlsnVerifierUrl?: string;
  /** TLSNotary WebSocket proxy URL (served to workers). */
  tlsnProxyUrl?: string;
  /** Persistent preimage-store file (JSON). Survives restarts. */
  preimageStorePath: string;
}

export const DEFAULT_RUNTIME_DATA_DIR = Deno.env.get("RUNTIME_DATA_DIR") ??
  join(moduleDir(import.meta), "..", ".local");
export function getRuntimeConfig(): RuntimeConfig {
  return {
    httpApiPort: readNumberEnv("HTTP_API_PORT", readNumberEnv("PORT", 3000)),
    querySweepIntervalMs: readNumberEnv("QUERY_SWEEP_INTERVAL_MS", 30_000),
    previewMaxDimension: readNumberEnv("PREVIEW_MAX_DIMENSION", 768),
    previewJpegQuality: readNumberEnv("PREVIEW_JPEG_QUALITY", 75),
    httpApiKeys: readStringListEnv("HTTP_API_KEYS", "HTTP_API_KEY"),
    anthropicApiKey: Deno.env.get("ANTHROPIC_API_KEY")?.trim() || undefined,
    aiContentCheckEnabled: Deno.env.get("AI_CONTENT_CHECK") === "true" ||
      Deno.env.get("AI_CONTENT_CHECK") === "1",
    trustedOraclePubkeys: readStringListEnv("TRUSTED_ORACLE_PUBKEYS"),
    tlsnVerifierUrl: Deno.env.get("TLSN_VERIFIER_URL")?.trim() || undefined,
    tlsnProxyUrl: Deno.env.get("TLSN_PROXY_URL")?.trim() || undefined,
    preimageStorePath: Deno.env.get("PREIMAGE_STORE_PATH")?.trim() ||
      join(DEFAULT_RUNTIME_DATA_DIR, "preimages.json"),
  };
}
