/**
 * Create a query with a real Cashu bounty for mobile wallet testing.
 *
 * Usage:
 *   CASHU_MINT_URL=http://localhost:3338 deno run --allow-all --env scripts/create-bounty-query.ts
 *   CASHU_MINT_URL=http://localhost:3338 deno run --allow-all --env scripts/create-bounty-query.ts --text-only
 *
 * Flags:
 *   --text-only  Create with verification_requirements: [] so text-only
 *                submissions are accepted (no photo required). Useful for
 *                API-only testing of the Cashu payment flow.
 *
 * Prerequisites:
 *   docker compose up -d && ./scripts/init-regtest.sh
 */

import { Wallet, type Proof, getEncodedToken } from "@cashu/cashu-ts";
import { spawn } from "../src/runtime/mod.ts";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";
const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const AMOUNT_SATS = 21;
const TEXT_ONLY = process.argv.includes("--text-only");

/**
 * Pay a BOLT11 invoice via lnd-user (regtest).
 * Falls back silently if lnd-user is not running (FakeWallet mode).
 */
async function payInvoiceViaLndUser(bolt11: string): Promise<boolean> {
  try {
    const proc = spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "payinvoice", "--force", bolt11,
    ], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Mint Cashu tokens, auto-paying the Lightning invoice if on regtest.
 */
async function mintTokens(amountSats: number): Promise<{ token: string; proofs: Proof[] }> {
  const wallet = new Wallet(MINT_URL, { unit: "sat" });
  await wallet.loadMint();

  const mintQuote = await wallet.createMintQuote(amountSats);
  console.log(`    Invoice: ${mintQuote.request.slice(0, 60)}...`);

  // Try to pay via lnd-user (regtest). If it fails, assume FakeWallet.
  console.log("    Paying invoice via lnd-user...");
  const paid = await payInvoiceViaLndUser(mintQuote.request);
  if (paid) {
    console.log("    Invoice paid via Lightning!");
  } else {
    console.log("    lnd-user not available, assuming FakeWallet mode.");
  }

  // Wait a moment for the mint to register the payment
  await new Promise((r) => setTimeout(r, 2000));

  const proofs = await wallet.mintProofs(amountSats, mintQuote.quote);
  const token = getEncodedToken({ mint: MINT_URL, proofs });
  return { token, proofs };
}

async function main() {
  console.log("=== Create Bounty Query ===\n");

  // 1. Mint a Cashu token
  console.log(`[1] Minting ${AMOUNT_SATS} sats on Cashu mint (${MINT_URL})...`);
  const bounty = await mintTokens(AMOUNT_SATS);
  console.log(`    Token: ${bounty.token.slice(0, 40)}...`);

  // 2. Create query with bounty
  const mode = TEXT_ONLY ? "text-only (no photo required)" : "photo-required (GPS verification)";
  console.log(`\n[2] Creating query with ${AMOUNT_SATS} sats bounty (${mode})...`);
  const queryPayload: Record<string, unknown> = {
    description: TEXT_ONLY
      ? "渋谷スクランブル交差点の現在の混雑状況を教えてください（テキストでOK）"
      : "渋谷スクランブル交差点の現在の混雑状況を撮影してください",
    location_hint: "Shibuya",
    expected_gps: { lat: 35.6595, lon: 139.7004 },
    ttl_seconds: 3600,
    bounty: {
      amount_sats: AMOUNT_SATS,
      cashu_token: bounty.token,
    },
  };
  if (TEXT_ONLY) {
    queryPayload.verification_requirements = [];
  }
  const res = await fetch(`${SERVER_URL}/queries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(queryPayload),
  });

  if (!res.ok) {
    console.error(`Failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const data = (await res.json()) as Record<string, unknown>;
  console.log(`    Query ID: ${data.query_id}`);
  console.log(`    Status: ${data.status}`);
  console.log(`    Payment: ${data.payment_status}`);
  console.log(`\n    Workers can now see this query in the mobile app.`);
  console.log(`    Submitting a result will earn ${AMOUNT_SATS} sats.\n`);
}

main().catch(console.error);
