/**
 * TLSNotary Fiat Swap (Coinbase Commerce) — Seller (has BTC, wants fiat/crypto)
 *
 * The seller creates an on-ramp order:
 *   1. Creates a Coinbase Commerce Charge for the payment amount
 *   2. Creates an Anchr query with TLSNotary requirements
 *      - Public: domain_hint = "api.commerce.coinbase.com" (visible to all Workers)
 *      - Private: Coinbase Commerce API key + Charge ID (delivered via
 *        NIP-44 encrypted_context to the selected Worker only)
 *   3. The SDK locks BTC in Cashu HTLC escrow and broadcasts via Nostr
 *
 * The buyer must then:
 *   - Pay the Coinbase Commerce Charge (crypto or fiat)
 *   - Use the Commerce API key (from encrypted_context) to fetch Charge status
 *   - Generate a TLSNotary proof of the Coinbase Commerce API response
 *   - Submit the proof to Anchr to redeem the escrowed BTC
 *
 * Usage:
 *   COINBASE_COMMERCE_API_KEY=xxx bun run example/tlsn-fiat-swap-coinbase/seller.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index.ts";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";
const COINBASE_COMMERCE_API_KEY = process.env.COINBASE_COMMERCE_API_KEY;

if (!COINBASE_COMMERCE_API_KEY) {
  console.error("COINBASE_COMMERCE_API_KEY is required.");
  console.error("Get it from: https://beta.commerce.coinbase.com/settings/security");
  console.error("Usage: COINBASE_COMMERCE_API_KEY=xxx bun run example/tlsn-fiat-swap-coinbase/seller.ts");
  process.exit(1);
}

const anchr = new Anchr({ serverUrl: SERVER_URL });

console.log("=== TLSNotary Fiat Swap (Coinbase Commerce) — Seller ===\n");
console.log(`Server: ${SERVER_URL}`);

// Step 1: Create a Coinbase Commerce Charge
// In production, create via API:
//   POST https://api.commerce.coinbase.com/charges
//   { "name": "BTC Swap", "pricing_type": "fixed_price",
//     "local_price": { "amount": "10.00", "currency": "USD" } }
const CHARGE_URL = process.env.COINBASE_CHARGE_URL ?? "https://commerce.coinbase.com/charges/xxxxx";
console.log(`Coinbase Commerce Charge: ${CHARGE_URL}\n`);

// Step 2: Create an Anchr query with domain_hint
const queryId = await anchr.createTlsnQuery({
  description: "Prove Coinbase Commerce payment — pay Charge, then prove payment status",
  targetUrl: "https://api.commerce.coinbase.com/",
  domainHint: "api.commerce.coinbase.com",
  conditions: [
    {
      type: "contains",
      expression: '"status":"COMPLETED"',
      description: "Charge must have a COMPLETED payment",
    },
  ],
  maxSats: 100_000,
  timeoutSeconds: 3600,
  maxAttestationAgeSeconds: 600,
});

// Note: In the full Nostr HTLC flow:
//   await selectWorker(state, workerPubkey, relayUrls, {
//     target_url: `https://api.commerce.coinbase.com/charges/${chargeId}`,
//     headers: { "X-CC-Api-Key": COINBASE_COMMERCE_API_KEY },
//   });

console.log("--- Order Created ---\n");
console.log(`Query ID: ${queryId}`);
console.log(`Escrowed: 100,000 sats in Cashu HTLC`);
console.log(`Timeout:  1 hour`);
console.log();
console.log("Waiting for buyer to:");
console.log(`  1. Pay Coinbase Commerce Charge: ${CHARGE_URL}`);
console.log("  2. Fetch Charge status via API (TLSNotary proves the JSON response)");
console.log("  3. Submit proof to Anchr");
console.log();

// Poll for query status
console.log("Monitoring order status...\n");

const startTime = Date.now();
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 3_600_000;

while (Date.now() - startTime < TIMEOUT_MS) {
  const status = await anchr.getQueryStatus(queryId);

  if (status.status === "approved") {
    console.log("\nOrder completed!");
    console.log(`  Status: ${status.status}`);
    console.log(`  Payment verified — BTC released to buyer`);
    if (status.verification) {
      console.log("  Verification checks:");
      for (const check of status.verification.checks) {
        console.log(`    ✓ ${check}`);
      }
    }
    break;
  }

  if (status.status === "rejected") {
    console.log("\nOrder rejected — proof verification failed.");
    if (status.verification?.failures) {
      for (const f of status.verification.failures) {
        console.log(`  ✗ ${f}`);
      }
    }
    console.log("Escrowed sats will be returned after locktime.");
    break;
  }

  if (status.status === "expired") {
    console.log("\nOrder expired — no valid proof submitted within timeout.");
    console.log("Escrowed sats returned to seller.");
    break;
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  process.stdout.write(`\r  Status: ${status.status} (${elapsed}s elapsed)`);

  await Bun.sleep(POLL_INTERVAL_MS);
}
