/**
 * TLSNotary Fiat Swap (Coinbase Commerce) — Buyer (has fiat/crypto, wants BTC)
 *
 * The buyer:
 *   1. Discovers open on-ramp orders on the Anchr network
 *   2. Pays the Coinbase Commerce Charge (crypto or fiat)
 *   3. Receives the Commerce API key + Charge ID from the seller
 *      (via NIP-44 encrypted_context in the Nostr selection event)
 *   4. Fetches the Charge status from Coinbase Commerce API
 *   5. Generates a TLSNotary proof of the JSON response
 *   6. Submits the proof to Anchr to redeem escrowed BTC
 *
 * Coinbase Commerce uses ECDSA TLS certificates, so MPC-TLS completes in ~2 seconds.
 *
 * Usage:
 *   bun run example/tlsn-fiat-swap-coinbase/buyer.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";

const anchr = new Anchr({ serverUrl: SERVER_URL });

console.log("=== TLSNotary Fiat Swap (Coinbase Commerce) — Buyer ===\n");
console.log(`Server: ${SERVER_URL}\n`);

// --- Step 1: Discover open on-ramp orders ---

console.log("Step 1: Finding open on-ramp orders...\n");

const orders = await anchr.listOpenQueries();
const onramp = orders.find((o) => o.description.includes("Coinbase Commerce"));

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

// --- Step 2: Pay Coinbase Commerce Charge ---

console.log("\n--- Step 2: Pay Coinbase Commerce Charge ---\n");
console.log("Open the Charge URL and pay with crypto or fiat.\n");

// --- Step 3: TLSNotary proof ---

console.log("--- Step 3: Generate TLSNotary Proof ---\n");
console.log("After the seller shares the Commerce API key and Charge ID");
console.log("(via NIP-44 encrypted_context), prove the Charge status:\n");
console.log("  Target URL: https://api.commerce.coinbase.com/charges/{charge_id}");
console.log("  Header: X-CC-Api-Key: {api_key}");
console.log();
console.log("The TLSNotary proof captures the JSON response from api.commerce.coinbase.com:");
console.log('  { "data": { "payments": [{ "status": "COMPLETED", ... }] } }');
console.log();
console.log("The proof cryptographically verifies:");
console.log("  1. Domain: api.commerce.coinbase.com (from TLS certificate, ECDSA)");
console.log('  2. Body contains: "status":"COMPLETED"');
console.log("  3. Attestation is fresh (< max_attestation_age_seconds)");

// --- Step 4: Submit proof ---

console.log("\n--- Step 4: Submit Proof ---\n");

// Coinbase Commerce uses ECDSA → both CLI and Extension work in ~2s
console.log("=== Method A: CLI (tlsn-prove) ===\n");
console.log("  tlsn-prove \\");
console.log('    --verifier localhost:7046 \\');
console.log('    -H "X-CC-Api-Key: $COINBASE_COMMERCE_API_KEY" \\');
console.log('    "https://api.commerce.coinbase.com/charges/$CHARGE_ID" \\');
console.log("    -o proof.presentation.tlsn\n");

console.log("=== Method B: TLSNotary Extension (DevConsole) ===\n");
console.log("  1. bun run scripts/launch-chrome-tlsn.ts");
console.log("  2. Open DevConsole → paste plugin code from RUNBOOK Step 6b");
console.log("  3. Run Code → Allow → proof copied to clipboard\n");

console.log("=== Submit to Anchr ===\n");
console.log(`  curl -X POST ${SERVER_URL}/queries/${onramp.id}/submit \\`);
console.log('    -H "Content-Type: application/json" \\');
console.log('    -d \'{"tlsn_presentation": "<base64-of-proof>"}\'');
console.log();
console.log("After successful verification:");
console.log("  - Oracle releases HTLC preimage");
console.log("  - Buyer redeems Cashu HTLC token with preimage + signature");
console.log(`  - ${onramp.bounty?.amount_sats ?? "100,000"} sats transferred trustlessly`);
