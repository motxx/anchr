import { isTlsnVerifierAvailable } from "@anchr/tlsn-toolkit/tlsn-validation";

export interface AirdropBotShieldRuntimeConfig {
  port: number;
  dbPath: string;
  adminToken?: string;
  nullifierSecret: string;
  settlement?: AirdropBotShieldSettlementConfig;
  productionReady: boolean;
  warnings: string[];
}

export interface AirdropBotShieldSettlementConfig {
  requesterRefundPubkey: string;
  sourceTokens: string[];
  locktimeSeconds: number;
  mintUrl?: string;
}

export function loadAirdropBotShieldRuntimeConfig(): AirdropBotShieldRuntimeConfig {
  const port = Number(Deno.env.get("AIRDROP_BOT_SHIELD_PORT") ?? Deno.env.get("PORT") ?? "3000");
  const dbPath = Deno.env.get("AIRDROP_BOT_SHIELD_DB_PATH")?.trim() || ".airdrop-bot-shield/airdrop-bot-shield.db";
  const adminToken = Deno.env.get("AIRDROP_BOT_SHIELD_ADMIN_TOKEN")?.trim();
  const nullifierSecret = Deno.env.get("AIRDROP_BOT_SHIELD_NULLIFIER_SECRET")?.trim() || "dev-nullifier-secret-change-before-mainnet";
  const settlement = loadSettlementConfig();
  const warnings = releaseConfigWarnings({ dbPath, adminToken, nullifierSecret, settlement });
  return {
    port: Number.isFinite(port) && port > 0 ? port : 3000,
    dbPath,
    adminToken,
    nullifierSecret,
    settlement,
    productionReady: warnings.length === 0,
    warnings,
  };
}

export function assertMainnetReleaseConfig(config: AirdropBotShieldRuntimeConfig): void {
  const network = Deno.env.get("AIRDROP_BOT_SHIELD_NETWORK")?.trim();
  const production = Deno.env.get("NODE_ENV") === "production" || network === "mainnet";
  if (!production) return;
  if (config.warnings.length > 0) {
    throw new Error(`Airdrop bot shield mainnet configuration is not release-ready: ${config.warnings.join("; ")}`);
  }
}

function releaseConfigWarnings(opts: {
  dbPath: string;
  adminToken?: string;
  nullifierSecret: string;
  settlement?: AirdropBotShieldSettlementConfig;
}): string[] {
  const warnings: string[] = [];
  if (!opts.adminToken || opts.adminToken.length < 32) {
    warnings.push("AIRDROP_BOT_SHIELD_ADMIN_TOKEN must be set to at least 32 characters");
  }
  if (!opts.nullifierSecret || opts.nullifierSecret.length < 32 || opts.nullifierSecret.includes("dev-nullifier")) {
    warnings.push("AIRDROP_BOT_SHIELD_NULLIFIER_SECRET must be a non-default secret with at least 32 characters");
  }
  if (opts.dbPath === ":memory:") {
    warnings.push("AIRDROP_BOT_SHIELD_DB_PATH must be durable, not :memory:");
  }
  const baseUrl = Deno.env.get("AIRDROP_BOT_SHIELD_PUBLIC_BASE_URL")?.trim();
  if (!baseUrl?.startsWith("https://")) {
    warnings.push("AIRDROP_BOT_SHIELD_PUBLIC_BASE_URL must be HTTPS");
  }
  const mintUrl = Deno.env.get("CASHU_MINT_URL")?.trim();
  if (!mintUrl?.startsWith("https://")) {
    warnings.push("CASHU_MINT_URL must be an HTTPS mainnet Cashu mint");
  }
  if (mintUrl && /localhost|127\.0\.0\.1|\[::1\]/.test(mintUrl)) {
    warnings.push("CASHU_MINT_URL must not point to localhost for mainnet");
  }
  if (!opts.settlement) {
    warnings.push("AIRDROP_BOT_SHIELD_REQUESTER_REFUND_PUBKEY and AIRDROP_BOT_SHIELD_SOURCE_CASHU_TOKENS must configure Cashu HTLC settlement");
  }
  if (!isTlsnVerifierAvailable()) {
    warnings.push("tlsn-verifier binary must be installed or built");
  }
  return warnings;
}

function loadSettlementConfig(): AirdropBotShieldSettlementConfig | undefined {
  const requesterRefundPubkey = Deno.env.get("AIRDROP_BOT_SHIELD_REQUESTER_REFUND_PUBKEY")?.trim();
  const sourceTokens = parseTokenList(Deno.env.get("AIRDROP_BOT_SHIELD_SOURCE_CASHU_TOKENS"));
  if (!requesterRefundPubkey || sourceTokens.length === 0) return undefined;
  const locktimeRaw = Number(Deno.env.get("AIRDROP_BOT_SHIELD_HTLC_LOCKTIME_SECONDS") ?? "0");
  const locktimeSeconds = Number.isInteger(locktimeRaw) && locktimeRaw > Math.floor(Date.now() / 1000)
    ? locktimeRaw
    : Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  return {
    requesterRefundPubkey,
    sourceTokens,
    locktimeSeconds,
    mintUrl: Deno.env.get("CASHU_MINT_URL")?.trim(),
  };
}

function parseTokenList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(/[\s,]+/).map((token) => token.trim()).filter((token) => token.startsWith("cashu"));
}
