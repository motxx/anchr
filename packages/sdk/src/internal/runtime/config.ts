import { join } from "node:path";
import { moduleDir } from "./mod.ts";

type EnvReader = (name: string) => string | undefined;

function readServerEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function readNumberEnv(
  readEnv: EnvReader,
  name: string,
  fallback: number,
): number {
  const value = readEnv(name);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readStringListEnv(readEnv: EnvReader, ...names: string[]): string[] {
  for (const name of names) {
    const value = readEnv(name);
    if (!value) continue;
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function readFirstEnv(
  readEnv: EnvReader,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = readEnv(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

export interface RuntimeConfig {
  httpApiPort: number;
  previewMaxDimension: number;
  previewJpegQuality: number;
  httpApiKeys: string[];
  /** Trusted Oracle pubkeys for Provider allowlist (from TRUSTED_ORACLE_PUBKEYS env). */
  trustedOraclePubkeys: string[];
  /** Persistent preimage-store file (JSON). Survives restarts. */
  preimageStorePath: string;
}

export interface LoggingRuntimeConfig {
  logLevel?: string;
}

export interface AttachmentRuntimeConfig {
  publicBaseUrl?: string;
  allowLocalhostAttachments: boolean;
  blossomServers: string[];
}

export interface OracleNostrRuntimeConfig {
  secretKeyHex?: string;
  relayUrls: string[];
}

export interface CashuRuntimeConfig {
  mintUrl?: string;
}

export interface AnchrConfigPort {
  runtime(): RuntimeConfig;
  logging(): LoggingRuntimeConfig;
  attachments(): AttachmentRuntimeConfig;
  oracleNostr(): OracleNostrRuntimeConfig;
  cashu(): CashuRuntimeConfig;
}

export const DEFAULT_RUNTIME_DATA_DIR = join(
  moduleDir(import.meta),
  "..",
  ".local",
);

function resolveRuntimeConfig(readEnv: EnvReader): RuntimeConfig {
  const runtimeDataDir = readEnv("RUNTIME_DATA_DIR") ??
    DEFAULT_RUNTIME_DATA_DIR;
  return {
    httpApiPort: readNumberEnv(
      readEnv,
      "HTTP_API_PORT",
      readNumberEnv(readEnv, "PORT", 3000),
    ),
    previewMaxDimension: readNumberEnv(readEnv, "PREVIEW_MAX_DIMENSION", 768),
    previewJpegQuality: readNumberEnv(readEnv, "PREVIEW_JPEG_QUALITY", 75),
    httpApiKeys: readStringListEnv(readEnv, "HTTP_API_KEYS", "HTTP_API_KEY"),
    trustedOraclePubkeys: readStringListEnv(readEnv, "TRUSTED_ORACLE_PUBKEYS"),
    preimageStorePath: readEnv("PREIMAGE_STORE_PATH")?.trim() ||
      join(runtimeDataDir, "preimages.json"),
  };
}

export const serverConfigPort: AnchrConfigPort = {
  runtime: () => resolveRuntimeConfig(readServerEnv),
  logging: () => ({
    logLevel: readFirstEnv(readServerEnv, "ANCHR_LOG_LEVEL", "LOG_LEVEL"),
  }),
  attachments: () => ({
    publicBaseUrl: readFirstEnv(
      readServerEnv,
      "ATTACHMENT_PUBLIC_BASE_URL",
      "PUBLIC_BASE_URL",
    ),
    allowLocalhostAttachments:
      readServerEnv("ANCHR_ALLOW_LOCALHOST_ATTACHMENTS") === "1",
    blossomServers: readStringListEnv(readServerEnv, "BLOSSOM_SERVERS")
      .map((url) => url.replace(/\/+$/, "")),
  }),
  oracleNostr: () => ({
    secretKeyHex: readServerEnv("ORACLE_NOSTR_SECRET_KEY")?.trim() || undefined,
    relayUrls: readStringListEnv(readServerEnv, "NOSTR_RELAYS"),
  }),
  cashu: () => ({
    mintUrl: readServerEnv("CASHU_MINT_URL")?.trim() || undefined,
  }),
};

export function getRuntimeConfig(
  config: AnchrConfigPort = serverConfigPort,
): RuntimeConfig {
  return config.runtime();
}

export function getLoggingConfig(
  config: AnchrConfigPort = serverConfigPort,
): LoggingRuntimeConfig {
  return config.logging();
}

export function getAttachmentConfig(
  config: AnchrConfigPort = serverConfigPort,
): AttachmentRuntimeConfig {
  return config.attachments();
}

export function getOracleNostrConfig(
  config: AnchrConfigPort = serverConfigPort,
): OracleNostrRuntimeConfig {
  return config.oracleNostr();
}

export function getCashuRuntimeConfig(
  config: AnchrConfigPort = serverConfigPort,
): CashuRuntimeConfig {
  return config.cashu();
}
