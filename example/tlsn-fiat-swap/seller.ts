/**
 * TLSNotary Fiat Swap — Seller (has BTC, wants fiat)
 *
 * The seller creates an on-ramp order:
 *   1. Creates a Stripe Payment Link for the fiat amount
 *   2. Creates an Anchr query with TLSNotary requirements
 *      - Public: domain_hint = "api.stripe.com" (visible to all Workers)
 *      - Private: Stripe API key + Checkout Session ID (delivered via
 *        NIP-44 encrypted_context to the selected Worker only)
 *   3. The SDK locks BTC in Cashu HTLC escrow and broadcasts via Nostr
 *
 * The buyer must then:
 *   - Pay via the Stripe Payment Link
 *   - Use the Stripe API key (from encrypted_context) to fetch Payment Intent status
 *   - Generate a TLSNotary proof of the Stripe API response
 *   - Submit the proof to Anchr to redeem the escrowed BTC
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... bun run example/tlsn-fiat-swap/seller.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is required.");
  console.error("Get it from: https://dashboard.stripe.com/test/apikeys");
  console.error("Usage: STRIPE_SECRET_KEY=sk_test_... bun run example/tlsn-fiat-swap/seller.ts");
  process.exit(1);
}

const anchr = new Anchr({ serverUrl: SERVER_URL });

console.log("=== TLSNotary Fiat Swap — Seller ===\n");
console.log(`Server: ${SERVER_URL}`);

// Step 1: Create a Stripe Payment Link (or use an existing one)
// In a real flow, the seller would create this programmatically via Stripe API.
// For this demo, use a pre-created Payment Link from the Stripe Dashboard.
const PAYMENT_LINK = process.env.STRIPE_PAYMENT_LINK ?? "https://buy.stripe.com/test_xxxxx";
console.log(`Stripe Payment Link: ${PAYMENT_LINK}\n`);

// Step 2: Create an Anchr query with domain_hint
// The public query only reveals the domain (api.stripe.com).
// The actual API URL + Authorization header will be delivered to the
// selected Worker via NIP-44 encrypted_context after Worker selection.
const queryId = await anchr.createTlsnQuery({
  description: "Prove Stripe payment — pay via Payment Link, then prove session status",
  // Public: only domain hint visible on Nostr relay
  targetUrl: "https://api.stripe.com/",
  domainHint: "api.stripe.com",
  conditions: [
    {
      type: "contains",
      expression: '"status":"succeeded"',
      description: "Payment Intent must have status=succeeded",
    },
  ],
  maxSats: 100_000,
  timeoutSeconds: 3600,
  maxAttestationAgeSeconds: 600,
});

// Note: In the full Nostr HTLC flow, the seller would also provide
// encrypted_context when selecting a Worker:
//
//   await selectWorker(state, workerPubkey, relayUrls, {
//     target_url: `https://api.stripe.com/v1/payment_intents/${paymentIntentId}`,
//     headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
//   });
//
// The Worker decrypts this via NIP-44 and uses it for proof generation.
// For the HTTP API demo, the Worker can receive the target URL and key
// through a separate channel (e.g., the seller tells the buyer directly).

console.log("--- Order Created ---\n");
console.log(`Query ID: ${queryId}`);
console.log(`Escrowed: 100,000 sats in Cashu HTLC`);
console.log(`Timeout:  1 hour`);
console.log();
console.log("Waiting for buyer to:");
console.log(`  1. Pay via Stripe Payment Link: ${PAYMENT_LINK}`);
console.log("  2. Fetch Stripe Payment Intent via API (TLSNotary proves the JSON response)");
console.log("  3. Submit proof to Anchr");
console.log();
console.log("After buyer pays, get the Payment Intent ID from Stripe Dashboard:");
console.log("  https://dashboard.stripe.com/test/payments");
console.log();

// Poll for query status
console.log("Monitoring order status...\n");

const startTime = Date.now();
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 3_600_000; // 1 hour

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
