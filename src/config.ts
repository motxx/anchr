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

export interface RuntimeConfig {
  dbPath: string;
  referenceAppPort: number;
  querySweepIntervalMs: number;
  previewMaxDimension: number;
  previewJpegQuality: number;
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
  };
}
