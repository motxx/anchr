/**
 * TLSNotary Fiat Swap — Buyer (has fiat, wants BTC)
 *
 * The buyer:
 *   1. Discovers open on-ramp orders on the Anchr network
 *   2. Pays via the seller's Stripe Payment Link (off-chain, manual step)
 *   3. Generates a TLSNotary proof of the Stripe receipt page
 *   4. Submits the proof to Anchr to redeem escrowed BTC
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
  console.log(`  Target URL: ${onramp.tlsn_requirements.target_url}`);
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

// --- Step 2: Instructions for fiat payment ---

console.log("\n--- Step 2: Pay via Stripe ---\n");
console.log("Open the Stripe Payment Link provided by the seller.");
console.log("Complete the payment (credit card, Apple Pay, etc.).");
console.log("Keep the receipt page open — you'll need it for the proof.\n");

// --- Step 3: Generate TLSNotary proof ---

console.log("--- Step 3: Generate TLSNotary Proof ---\n");
console.log("Use the TLSNotary browser extension to generate a proof:");
console.log("  1. Open the Stripe receipt page in your browser");
console.log("  2. Click the TLSN extension icon");
console.log("  3. Start a notarization session");
console.log("  4. The extension generates a .presentation.tlsn file\n");

// --- Step 4: Submit proof ---

console.log("--- Step 4: Submit Proof ---\n");

// In a real flow, the buyer would load the .presentation.tlsn file
// and submit it to Anchr:
//
//   const proofFile = Bun.file("stripe-receipt.presentation.tlsn");
//   const proofBase64 = Buffer.from(await proofFile.arrayBuffer()).toString("base64");
//   const result = await anchr.submitPresentation(onramp.id, proofBase64);
//   console.log(`Submitted: ${result.ok}`);
//   console.log(`Message: ${result.message}`);
//
// If verification passes, the Oracle releases the HTLC preimage
// and the buyer can redeem the escrowed sats.

console.log("Example submission code:\n");
console.log('  const proof = Bun.file("stripe-receipt.presentation.tlsn");');
console.log('  const proofBase64 = Buffer.from(await proof.arrayBuffer()).toString("base64");');
console.log(`  const result = await anchr.submitPresentation("${onramp.id}", proofBase64);`);
console.log();
console.log("After successful verification:");
console.log("  - Oracle releases HTLC preimage");
console.log("  - Buyer redeems Cashu HTLC token with preimage + signature");
console.log(`  - ${onramp.bounty?.amount_sats ?? "100,000"} sats transferred trustlessly`);
