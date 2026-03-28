/**
 * zkP2P On-ramp — Seller (has BTC, wants fiat)
 *
 * The seller creates an on-ramp order:
 *   1. Defines the payment conditions (PayPal amount, recipient, status)
 *   2. Creates an Anchr query with TLSNotary requirements
 *   3. The SDK locks BTC in Cashu HTLC escrow and broadcasts via Nostr
 *
 * The buyer must then:
 *   - Send fiat via PayPal
 *   - Generate a TLSNotary proof of the transaction page
 *   - Submit the proof to Anchr to redeem the escrowed BTC
 *
 * Usage:
 *   bun run example/zkp2p-onramp/seller.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";

const anchr = new Anchr({ serverUrl: SERVER_URL });

console.log("=== zkP2P On-ramp — Seller ===\n");
console.log(`Server: ${SERVER_URL}\n`);

// Create an on-ramp order.
// The SDK handles:
//   1. Creating the Cashu HTLC escrow (locking sats)
//   2. Building the query with TLSNotary verification requirements
//   3. Broadcasting the order via Nostr relay
const queryId = await anchr.createTlsnQuery({
  description: "Prove PayPal payment of $70.00 to seller@example.com",
  targetUrl: "https://www.paypal.com/activity/payment/{transaction_id}",
  conditions: [
    {
      type: "contains",
      expression: "Completed",
      description: "Payment status must be completed",
    },
    {
      type: "contains",
      expression: "$70.00",
      description: "Payment amount must be $70.00",
    },
    {
      type: "contains",
      expression: "seller@example.com",
      description: "Recipient must be seller@example.com",
    },
  ],
  maxSats: 100_000,
  timeoutSeconds: 3600,
  maxAttestationAgeSeconds: 600,
});

console.log("--- Order Created ---\n");
console.log(`Query ID: ${queryId}`);
console.log(`Escrowed: 100,000 sats in Cashu HTLC`);
console.log(`Timeout:  1 hour`);
console.log();
console.log("Waiting for buyer to:");
console.log("  1. Send $70.00 to seller@example.com on PayPal");
console.log("  2. Generate TLSNotary proof of the transaction");
console.log("  3. Submit proof to Anchr");
console.log();

// Poll for query status
console.log("Monitoring order status...\n");

const startTime = Date.now();
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 3_600_000; // 1 hour

while (Date.now() - startTime < TIMEOUT_MS) {
  const status = await anchr.getQueryStatus(queryId);

  if (status.status === "approved") {
    console.log("Order completed!");
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
    console.log("Order rejected — proof verification failed.");
    if (status.verification?.failures) {
      for (const f of status.verification.failures) {
        console.log(`  ✗ ${f}`);
      }
    }
    console.log("Escrowed sats will be returned after locktime.");
    break;
  }

  if (status.status === "expired") {
    console.log("Order expired — no valid proof submitted within timeout.");
    console.log("Escrowed sats returned to seller.");
    break;
  }

  // Still waiting
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  process.stdout.write(`\r  Status: ${status.status} (${elapsed}s elapsed)`);

  await Bun.sleep(POLL_INTERVAL_MS);
}
