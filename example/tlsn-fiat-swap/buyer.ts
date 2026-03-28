/**
 * TLSNotary Fiat Swap — Buyer (has fiat, wants BTC)
 *
 * The buyer:
 *   1. Discovers open on-ramp orders on the Anchr network
 *   2. Pays via the seller's Stripe Payment Link
 *   3. Receives the Stripe API key + Session ID from the seller
 *      (via NIP-44 encrypted_context in the Nostr selection event)
 *   4. Fetches the Checkout Session status from Stripe API
 *   5. Generates a TLSNotary proof of the JSON response
 *   6. Submits the proof to Anchr to redeem escrowed BTC
 *
 * Usage:
 *   bun run example/tlsn-fiat-swap/buyer.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";

const anchr = new Anchr({ serverUrl: SERVER_URL });

console.log("=== TLSNotary Fiat Swap — Buyer ===\n");
console.log(`Server: ${SERVER_URL}\n`);

// --- Step 1: Discover open on-ramp orders ---

console.log("Step 1: Finding open on-ramp orders...\n");

const orders = await anchr.listOpenQueries();
const onramp = orders.find((o) => o.description.includes("Stripe payment"));

if (!onramp) {
  console.log("No open on-ramp orders found.");
  console.log("Run seller.ts first to create one.");
  process.exit(0);
}

console.log(`Found order: ${onramp.id}`);
console.log(`  Description: ${onramp.description}`);
console.log(`  Bounty: ${onramp.bounty?.amount_sats ?? 0} sats`);

if (onramp.tlsn_requirements) {
  const domain = onramp.tlsn_requirements.domain_hint ?? onramp.tlsn_requirements.target_url;
  console.log(`  Domain: ${domain}`);
  if (onramp.tlsn_requirements.conditions) {
    console.log("  Conditions:");
    for (const cond of onramp.tlsn_requirements.conditions) {
      console.log(`    - [${cond.type}] "${cond.expression}" — ${cond.description ?? ""}`);
    }
  }
  if (onramp.tlsn_requirements.max_attestation_age_seconds) {
    console.log(`  Max attestation age: ${onramp.tlsn_requirements.max_attestation_age_seconds}s`);
  }
}

// --- Step 2: Pay via Stripe ---

console.log("\n--- Step 2: Pay via Stripe ---\n");
console.log("Open the seller's Stripe Payment Link and complete the payment.");
console.log("Use test card: 4242 4242 4242 4242, any future expiry, any CVC.\n");

// --- Step 3: TLSNotary proof of Stripe API ---

console.log("--- Step 3: Generate TLSNotary Proof of Stripe API ---\n");
console.log("After the seller shares the Stripe API key and Checkout Session ID");
console.log("(via NIP-44 encrypted_context), fetch the session status:\n");
console.log("  Target URL: https://api.stripe.com/v1/checkout/sessions/{cs_test_...}");
console.log("  Header: Authorization: Bearer {stripe_secret_key}");
console.log();
console.log("The TLSNotary proof captures the JSON response from api.stripe.com:");
console.log('  { "payment_status": "paid", "amount_total": 10000, ... }');
console.log();
console.log("The proof cryptographically verifies:");
console.log("  1. Domain: api.stripe.com (from TLS certificate)");
console.log('  2. Body contains: "payment_status":"paid"');
console.log("  3. Attestation is fresh (< max_attestation_age_seconds)");

// --- Step 4: Submit proof ---

console.log("\n--- Step 4: Submit Proof ---\n");

// In a real flow with NIP-44 encrypted_context:
//
//   // Worker receives encrypted_context after being selected
//   const ctx = decryptedContext; // { target_url, headers }
//
//   // Generate proof using tlsn-prove with custom headers
//   // tlsn-prove -H "Authorization: Bearer sk_test_..." https://api.stripe.com/v1/checkout/sessions/cs_test_...
//
//   // Submit to Anchr
//   const result = await anchr.submitPresentation(onramp.id, proofBase64);

console.log("Example with curl + Anchr submit:\n");
console.log("  # Generate TLSNotary proof (via tlsn-prove CLI)");
console.log('  tlsn-prove \\');
console.log('    --verifier localhost:7047 \\');
console.log('    -H "Authorization: Bearer $STRIPE_SECRET_KEY" \\');
console.log('    "https://api.stripe.com/v1/checkout/sessions/$SESSION_ID" \\');
console.log('    -o proof.presentation.tlsn');
console.log();
console.log("  # Submit to Anchr");
console.log(`  curl -X POST ${SERVER_URL}/queries/${onramp.id}/submit \\`);
console.log('    -H "Content-Type: application/json" \\');
console.log('    -d \'{"tlsn_presentation": "<base64-of-proof>"}\'');
console.log();
console.log("After successful verification:");
console.log("  - Oracle releases HTLC preimage");
console.log("  - Buyer redeems Cashu HTLC token with preimage + signature");
console.log(`  - ${onramp.bounty?.amount_sats ?? "100,000"} sats transferred trustlessly`);
