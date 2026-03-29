/**
 * TLSNotary Fiat Swap (Square) — Buyer (has fiat, wants BTC)
 *
 * The buyer:
 *   1. Discovers open on-ramp orders on the Anchr network
 *   2. Pays via the seller's Square Payment Link
 *   3. Receives the Square access token + Payment ID from the seller
 *      (via NIP-44 encrypted_context in the Nostr selection event)
 *   4. Fetches the Payment status from Square API
 *   5. Generates a TLSNotary proof of the JSON response
 *   6. Submits the proof to Anchr to redeem escrowed BTC
 *
 * Square uses ECDSA TLS certificates, so MPC-TLS completes in ~2 seconds
 * (unlike Stripe which uses RSA and hangs).
 *
 * Usage:
 *   bun run example/tlsn-fiat-swap-square/buyer.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";

const anchr = new Anchr({ serverUrl: SERVER_URL });

console.log("=== TLSNotary Fiat Swap (Square) — Buyer ===\n");
console.log(`Server: ${SERVER_URL}\n`);

// --- Step 1: Discover open on-ramp orders ---

console.log("Step 1: Finding open on-ramp orders...\n");

const orders = await anchr.listOpenQueries();
const onramp = orders.find((o) => o.description.includes("Square payment"));

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
}

// --- Step 2: Pay via Square ---

console.log("\n--- Step 2: Pay via Square ---\n");
console.log("Open the seller's Square Payment Link and complete the payment.\n");

// --- Step 3: TLSNotary proof of Square API ---

console.log("--- Step 3: Generate TLSNotary Proof ---\n");
console.log("After the seller shares the Square access token and Payment ID");
console.log("(via NIP-44 encrypted_context), prove the Payment status:\n");
console.log("  Target URL: https://connect.squareupsandbox.com/v2/payments/{payment_id}");
console.log("  Header: Authorization: Bearer {access_token}");
console.log();
console.log("The TLSNotary proof captures the JSON response from connect.squareupsandbox.com:");
console.log('  { "payment": { "status": "COMPLETED", "amount_money": { ... } } }');
console.log();
console.log("The proof cryptographically verifies:");
console.log("  1. Domain: connect.squareupsandbox.com (from TLS certificate, ECDSA)");
console.log('  2. Body contains: "status":"COMPLETED"');
console.log("  3. Attestation is fresh (< max_attestation_age_seconds)");

// --- Step 4: Submit proof ---

console.log("\n--- Step 4: Submit Proof ---\n");

// CLI approach (Square uses ECDSA → MPC-TLS completes in ~2s)
console.log("Generate proof using tlsn-prove CLI:\n");
console.log("  tlsn-prove \\");
console.log('    --verifier localhost:7046 \\');
console.log('    -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \\');
console.log('    "https://connect.squareupsandbox.com/v2/payments/$PAYMENT_ID" \\');
console.log("    -o proof.presentation.tlsn");
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
