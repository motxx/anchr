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
  dbPath: string;
  referenceAppPort: number;
  querySweepIntervalMs: number;
  previewMaxDimension: number;
  previewJpegQuality: number;
  httpApiKeys: string[];
  anthropicApiKey?: string;
  aiContentCheckEnabled: boolean;
  remoteQueryApiBaseUrl?: string;
  remoteQueryApiKey?: string;
}

export const DEFAULT_RUNTIME_DATA_DIR = process.env.RUNTIME_DATA_DIR ?? join(import.meta.dir, "..", ".local");
export const DEFAULT_UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(DEFAULT_RUNTIME_DATA_DIR, "uploads");
export const DEFAULT_DB_PATH = process.env.DB_PATH ?? join(DEFAULT_RUNTIME_DATA_DIR, "queries.db");

export function getRuntimeConfig(): RuntimeConfig {
  return {
    dbPath: DEFAULT_DB_PATH,
    referenceAppPort: readNumberEnv("REFERENCE_APP_PORT", readNumberEnv("PORT", 3000)),
    querySweepIntervalMs: readNumberEnv("QUERY_SWEEP_INTERVAL_MS", 30_000),
    previewMaxDimension: readNumberEnv("PREVIEW_MAX_DIMENSION", 768),
    previewJpegQuality: readNumberEnv("PREVIEW_JPEG_QUALITY", 75),
    httpApiKeys: readStringListEnv("HTTP_API_KEYS", "HTTP_API_KEY"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    aiContentCheckEnabled: process.env.AI_CONTENT_CHECK === "true" || process.env.AI_CONTENT_CHECK === "1",
    remoteQueryApiBaseUrl: process.env.REMOTE_QUERY_API_BASE_URL?.trim() || undefined,
    remoteQueryApiKey: process.env.REMOTE_QUERY_API_KEY?.trim() || undefined,
  };
}
