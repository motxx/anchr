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
  inlineAttachmentLimitBytes: number;
}

export const DEFAULT_RUNTIME_DATA_DIR = join(import.meta.dir, "..", ".local");
export const DEFAULT_UPLOADS_DIR = join(DEFAULT_RUNTIME_DATA_DIR, "uploads");
export const DEFAULT_DB_PATH = join(DEFAULT_RUNTIME_DATA_DIR, "queries.db");

export function getRuntimeConfig(): RuntimeConfig {
  return {
    dbPath: process.env.DB_PATH ?? DEFAULT_DB_PATH,
    referenceAppPort: readNumberEnv("REFERENCE_APP_PORT", 3000),
    querySweepIntervalMs: readNumberEnv("QUERY_SWEEP_INTERVAL_MS", 30_000),
    inlineAttachmentLimitBytes: readNumberEnv("INLINE_ATTACHMENT_LIMIT_BYTES", 512 * 1024),
  };
}
