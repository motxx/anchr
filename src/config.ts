import { join } from "node:path";

function readNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readStringListEnv(...names: string[]): string[] {
  for (const name of names) {
    const value = process.env[name];
    if (!value) continue;
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export interface RuntimeConfig {
  referenceAppPort: number;
  querySweepIntervalMs: number;
  previewMaxDimension: number;
  previewJpegQuality: number;
  httpApiKeys: string[];
  anthropicApiKey?: string;
  aiContentCheckEnabled: boolean;
  remoteQueryApiBaseUrl?: string;
  remoteQueryApiKey?: string;
  /** Trusted Oracle pubkeys for Worker whitelist (from TRUSTED_ORACLE_PUBKEYS env). */
  trustedOraclePubkeys: string[];
  /** Trusted TLSNotary notary public keys (hex). */
  trustedNotaryPubkeys: string[];
  /** Default TLSNotary notary URL. */
  defaultNotaryUrl?: string;
}

export const DEFAULT_RUNTIME_DATA_DIR = process.env.RUNTIME_DATA_DIR ?? join(import.meta.dir, "..", ".local");
export function getRuntimeConfig(): RuntimeConfig {
  return {
    referenceAppPort: readNumberEnv("REFERENCE_APP_PORT", readNumberEnv("PORT", 3000)),
    querySweepIntervalMs: readNumberEnv("QUERY_SWEEP_INTERVAL_MS", 30_000),
    previewMaxDimension: readNumberEnv("PREVIEW_MAX_DIMENSION", 768),
    previewJpegQuality: readNumberEnv("PREVIEW_JPEG_QUALITY", 75),
    httpApiKeys: readStringListEnv("HTTP_API_KEYS", "HTTP_API_KEY"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    aiContentCheckEnabled: process.env.AI_CONTENT_CHECK === "true" || process.env.AI_CONTENT_CHECK === "1",
    remoteQueryApiBaseUrl: process.env.REMOTE_QUERY_API_BASE_URL?.trim() || undefined,
    remoteQueryApiKey: process.env.REMOTE_QUERY_API_KEY?.trim() || undefined,
    trustedOraclePubkeys: readStringListEnv("TRUSTED_ORACLE_PUBKEYS"),
    trustedNotaryPubkeys: readStringListEnv("TRUSTED_NOTARY_PUBKEYS"),
    defaultNotaryUrl: process.env.DEFAULT_NOTARY_URL?.trim() || undefined,
  };
}
