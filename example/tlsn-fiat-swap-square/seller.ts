/**
 * TLSNotary Fiat Swap (Square) — Seller (has BTC, wants fiat)
 *
 * The seller creates an on-ramp order:
 *   1. Creates a Square Payment Link for the fiat amount
 *   2. Creates an Anchr query with TLSNotary requirements
 *      - Public: domain_hint = "connect.squareupsandbox.com" (visible to all Workers)
 *      - Private: Square access token + Payment ID (delivered via
 *        NIP-44 encrypted_context to the selected Worker only)
 *   3. The SDK locks BTC in Cashu HTLC escrow and broadcasts via Nostr
 *
 * The buyer must then:
 *   - Pay via the Square Payment Link
 *   - Use the Square access token (from encrypted_context) to fetch Payment status
 *   - Generate a TLSNotary proof of the Square API response
 *   - Submit the proof to Anchr to redeem the escrowed BTC
 *
 * Usage:
 *   SQUARE_ACCESS_TOKEN=EAAAl... bun run example/tlsn-fiat-swap-square/seller.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index.ts";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

if (!SQUARE_ACCESS_TOKEN) {
  console.error("SQUARE_ACCESS_TOKEN is required.");
  console.error("Get it from: https://developer.squareup.com/apps → Sandbox Access Token");
  console.error("Usage: SQUARE_ACCESS_TOKEN=EAAAl... bun run example/tlsn-fiat-swap-square/seller.ts");
  process.exit(1);
}

const anchr = new Anchr({ serverUrl: SERVER_URL });

console.log("=== TLSNotary Fiat Swap (Square) — Seller ===\n");
console.log(`Server: ${SERVER_URL}`);

// Step 1: Create a Square Payment Link (or use an existing one)
const PAYMENT_LINK = process.env.SQUARE_PAYMENT_LINK ?? "https://square.link/u/xxxxx";
console.log(`Square Payment Link: ${PAYMENT_LINK}\n`);

// Step 2: Create an Anchr query with domain_hint
const queryId = await anchr.createTlsnQuery({
  description: "Prove Square payment — pay via Payment Link, then prove payment status",
  targetUrl: "https://connect.squareupsandbox.com/",
  domainHint: "connect.squareupsandbox.com",
  conditions: [
    {
      type: "contains",
      expression: '"status": "COMPLETED"',
      description: "Payment must have status=COMPLETED",
    },
  ],
  maxSats: 100_000,
  timeoutSeconds: 3600,
  maxAttestationAgeSeconds: 600,
});

// Note: In the full Nostr HTLC flow:
//   await selectWorker(state, workerPubkey, relayUrls, {
//     target_url: `https://connect.squareupsandbox.com/v2/payments/${paymentId}`,
//     headers: { "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}` },
//   });

console.log("--- Order Created ---\n");
console.log(`Query ID: ${queryId}`);
console.log(`Escrowed: 100,000 sats in Cashu HTLC`);
console.log(`Timeout:  1 hour`);
console.log();
console.log("Waiting for buyer to:");
console.log(`  1. Pay via Square Payment Link: ${PAYMENT_LINK}`);
console.log("  2. Fetch Square Payment via API (TLSNotary proves the JSON response)");
console.log("  3. Submit proof to Anchr");
console.log();
console.log("After buyer pays, get the Payment ID from Square Dashboard:");
console.log("  https://squareupsandbox.com/dashboard/sales/transactions");
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

  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}
