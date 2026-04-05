/**
 * Auto-Claim Demo — Insurance Provider
 *
 * Creates a conditional bounty: "if flight NH123 is delayed ≥ 120 min,
 * pay 10,000 sats to whoever submits proof."
 *
 * In production, this would be a parametric insurance protocol that
 * creates bounties automatically when a user purchases a policy.
 *
 * Usage:
 *   ANCHR_URL=http://localhost:3000 \
 *   deno run --allow-all --env example/auto-claim/insurer.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index";

const SERVER_URL = Deno.env.get("ANCHR_URL") ?? "http://localhost:3000";
const AIRLINE_URL = Deno.env.get("AIRLINE_URL") ?? "http://localhost:4000";
const FLIGHT = Deno.env.get("FLIGHT") ?? "NH123";
const PAYOUT_SATS = Number(Deno.env.get("PAYOUT_SATS") ?? "10000");

const anchr = new Anchr({ serverUrl: SERVER_URL });

console.log("=== Auto-Claim — Insurance Provider ===\n");
console.log(`Anchr:   ${SERVER_URL}`);
console.log(`Airline: ${AIRLINE_URL}`);
console.log(`Flight:  ${FLIGHT}`);
console.log(`Payout:  ${PAYOUT_SATS} sats on delay >= 120 min\n`);

// Create flight delay compensation bounty.
// Two conditions — both must pass:
//   1. jsonpath: status field must equal "delayed"
//   2. regex:    delay_minutes must be >= 120
const queryId = await anchr.createTlsnQuery({
  description: `Auto-claim: ${FLIGHT} delay >= 120 min → ${PAYOUT_SATS} sats`,
  targetUrl: `${AIRLINE_URL}/api/flights/${FLIGHT}`,
  conditions: [
    {
      type: "jsonpath",
      expression: "status",
      expected: "delayed",
      description: "Flight status must be 'delayed'",
    },
    {
      type: "regex",
      // Matches delay_minutes >= 120:
      //   1[2-9]\d  → 120-199
      //   [2-9]\d{2} → 200-999
      //   \d{4,}     → 1000+
      expression: '"delay_minutes":\\s*(1[2-9]\\d|[2-9]\\d{2}|\\d{4,})',
      description: "Delay must be >= 120 minutes",
    },
  ],
  maxSats: PAYOUT_SATS,
  timeoutSeconds: 3600,
  maxAttestationAgeSeconds: 300, // proof must be < 5 min old
});

console.log("--- Policy Created ---\n");
console.log(`Query ID:  ${queryId}`);
console.log(`Condition: status = "delayed" AND delay >= 120 min`);
console.log(`Payout:    ${PAYOUT_SATS} sats`);
console.log(`Valid for: 1 hour\n`);
console.log("Waiting for claim...\n");

// Poll for claim result
const startTime = Date.now();

while (Date.now() - startTime < 3_600_000) {
  const status = await anchr.getQueryStatus(queryId);

  if (status.status === "approved") {
    console.log("\nClaim approved!");
    console.log(`  Flight ${FLIGHT} was delayed`);
    console.log(`  ${PAYOUT_SATS} sats paid to claimant`);
    if (status.verification) {
      for (const check of status.verification.checks) {
        console.log(`  ✓ ${check}`);
      }
    }
    break;
  }

  if (status.status === "rejected") {
    console.log("\nClaim rejected — proof verification failed");
    if (status.verification?.failures) {
      for (const f of status.verification.failures) console.log(`  ✗ ${f}`);
    }
    break;
  }

  if (status.status === "expired") {
    console.log("\nPolicy expired — no delay occurred during coverage period.");
    console.log("No sats paid. (This is good news for the insurer.)");
    break;
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  await Deno.stdout.write(
    new TextEncoder().encode(`\r  Awaiting claim... (${elapsed}s)`),
  );
  await new Promise((r) => setTimeout(r, 5000));
}
