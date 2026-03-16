#!/usr/bin/env bun
/**
 * Create a query with a real Cashu bounty for mobile wallet testing.
 *
 * Usage:
 *   CASHU_MINT_URL=http://localhost:3338 bun run scripts/create-bounty-query.ts
 *
 * Prerequisites:
 *   docker compose up -d  (starts relay, Blossom, Cashu mint with FakeWallet)
 */

import { createBountyToken } from "../src/cashu/wallet";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";
const AMOUNT_SATS = 21;

async function main() {
  console.log("=== Create Bounty Query ===\n");

  // 1. Mint a Cashu token
  console.log(`[1] Minting ${AMOUNT_SATS} sats on Cashu mint...`);
  const bounty = await createBountyToken(AMOUNT_SATS);
  if (!bounty) {
    console.error("Failed to mint token. Is CASHU_MINT_URL set?");
    process.exit(1);
  }
  console.log(`    Token: ${bounty.token.slice(0, 40)}...`);

  // 2. Create query with bounty
  console.log(`\n[2] Creating query with ${AMOUNT_SATS} sats bounty...`);
  const res = await fetch(`${SERVER_URL}/queries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "渋谷スクランブル交差点の現在の混雑状況を撮影してください",
      location_hint: "Shibuya",
      expected_gps: { lat: 35.6595, lon: 139.7004 },
      ttl_seconds: 600,
      bounty: {
        amount_sats: AMOUNT_SATS,
        cashu_token: bounty.token,
      },
    }),
  });

  if (!res.ok) {
    console.error(`Failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const data = await res.json() as Record<string, unknown>;
  console.log(`    Query ID: ${data.query_id}`);
  console.log(`    Status: ${data.status}`);
  console.log(`    Payment: ${data.payment_status}`);
  console.log(`\n    Workers can now see this query in the mobile app.`);
  console.log(`    Submitting a result will earn ${AMOUNT_SATS} sats.\n`);
}

main().catch(console.error);
