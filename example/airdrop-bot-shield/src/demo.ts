/**
 * Airdrop Bot Shield — Demo
 *
 * Simulates the full airdrop claim flow:
 *   1. Project creates an airdrop campaign with GitHub-based criteria
 *   2. Shows what the TLSNotary proof requests look like
 *   3. Simulates verification with mock GitHub API responses
 *   4. Demonstrates the Cashu HTLC escrow and redemption flow
 *
 * Usage:
 *   deno run --allow-all example/airdrop-bot-shield/src/demo.ts
 *
 * Reference modules (not imported at runtime — this example is self-contained):
 *   - TlsnRequirement, TlsnCondition, HtlcInfo from ../../../src/domain/types
 *   - validateTlsn from ../../../src/infrastructure/verification/tlsn-validation
 *   - createHtlcToken, redeemHtlcToken from ../../../src/infrastructure/cashu/escrow
 */

import {
  buildGitHubAgeCondition,
  buildGitHubReposCondition,
  buildGitHubContributionCondition,
  buildTwitterFollowerCondition,
  validateCriteria,
  maxClaims,
  toTlsnRequirements,
  type AirdropCriteria,
  type GitHubUserResponse,
} from "./airdrop-criteria.ts";

import {
  verifyClaim,
  generateClaimHashAsync,
  type VerifiedProofData,
} from "./claim-verifier.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function separator(title: string): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(70)}\n`);
}

function indent(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Step 1: Create Airdrop Campaign
// ---------------------------------------------------------------------------

separator("Step 1: Project Creates Airdrop Campaign");

const criteria: AirdropCriteria = {
  id: "airdrop_genesis_2026",
  name: "Protocol Genesis Airdrop",
  conditions: [
    buildGitHubAgeCondition(365),
    buildGitHubReposCondition(10),
    buildGitHubContributionCondition(5),
  ],
  token_amount_per_claim: 50_000, // 50k sats per claim
  total_budget_sats: 10_000_000, // 10M sats total budget
};

console.log(`Campaign: ${criteria.name}`);
console.log(`ID:       ${criteria.id}`);
console.log(`Budget:   ${criteria.total_budget_sats.toLocaleString()} sats`);
console.log(`Per claim: ${criteria.token_amount_per_claim.toLocaleString()} sats`);
console.log(`Max claims: ${maxClaims(criteria)}`);

console.log("\nEligibility conditions:");
for (const [i, cond] of criteria.conditions.entries()) {
  console.log(`  [${i}] ${cond.description}`);
  console.log(`      Type:     ${cond.type}`);
  console.log(`      URL:      ${cond.target_url}`);
  console.log(`      JSONPath: ${cond.jsonpath}`);
  console.log(`      Min:      ${cond.min_value ?? "N/A"}`);
}

// Validate
const errors = validateCriteria(criteria);
if (errors.length > 0) {
  console.error("\nValidation errors:");
  for (const err of errors) {
    console.error(`  ${err.field}: ${err.message}`);
  }
  Deno.exit(1);
}
console.log("\nValidation: PASSED (all criteria valid)");

// ---------------------------------------------------------------------------
// Step 2: Show TLSNotary Proof Requirements
// ---------------------------------------------------------------------------

separator("Step 2: TLSNotary Proof Requirements");

console.log("The claimant must generate one TLSNotary proof per condition.");
console.log("Each proof cryptographically verifies the HTTP response from the target URL.\n");

const tlsnRequirements = toTlsnRequirements(criteria.conditions);
for (const [i, req] of tlsnRequirements.entries()) {
  console.log(`Proof #${i}:`);
  console.log(`  Target:      ${req.target_url}`);
  console.log(`  Method:      ${req.method}`);
  console.log(`  Domain hint: ${req.domain_hint}`);
  console.log(`  Max age:     ${req.max_attestation_age_seconds}s`);
  console.log(`  Conditions:`);
  for (const cond of req.conditions) {
    console.log(`    - [${cond.type}] ${cond.expression} -- ${cond.description}`);
  }
  console.log();
}

console.log("In practice, the claimant would:");
console.log("  1. Open the TLSNotary browser extension");
console.log("  2. Navigate to https://api.github.com/users/<their-username>");
console.log("  3. The extension runs an MPC-TLS session with a TLSNotary verifier");
console.log("  4. The cryptographic presentation (.presentation.tlsn) is generated");
console.log("  5. The presentation is submitted to the Anchr oracle for verification");

// ---------------------------------------------------------------------------
// Step 3: Simulate Verification (Mock Data)
// ---------------------------------------------------------------------------

separator("Step 3: Simulate Claim Verification");

console.log("Simulating a claim from a legitimate GitHub user...\n");

// Mock GitHub API response for a real developer
const mockGitHubResponse: GitHubUserResponse = {
  login: "satoshi",
  id: 583231,
  created_at: "2020-06-15T10:30:00Z", // ~2100 days old as of 2026
  public_repos: 47,
  public_gists: 12,
  followers: 892,
  following: 34,
};

console.log("Mock GitHub API response (this is what TLSNotary would prove):");
console.log(indent(JSON.stringify(mockGitHubResponse, null, 2)));

// Create verified proof data (simulating what tlsn-verifier binary outputs)
const now = Math.floor(Date.now() / 1000);
const githubVerifiedData: VerifiedProofData = {
  server_name: "api.github.com",
  revealed_body: JSON.stringify(mockGitHubResponse),
  session_timestamp: now - 30, // 30 seconds ago
};

// Build the proof map (one proof per condition, all from the same GitHub response)
const verifiedProofs = new Map<number, VerifiedProofData>();
verifiedProofs.set(0, githubVerifiedData); // GitHub account age
verifiedProofs.set(1, githubVerifiedData); // GitHub repos
verifiedProofs.set(2, githubVerifiedData); // GitHub contributions

// Generate HTLC hash/preimage for this claim
const { preimage, hash } = await generateClaimHashAsync();
console.log(`\nHTLC escrow:`);
console.log(`  Preimage: ${preimage.slice(0, 16)}...${preimage.slice(-16)}`);
console.log(`  Hash:     ${hash.slice(0, 16)}...${hash.slice(-16)}`);

// Verify
console.log("\nVerifying claim...\n");
const result = verifyClaim(criteria, verifiedProofs, preimage);

for (const r of result.results) {
  const icon = r.passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${icon} ${r.reason}`);
  if (r.extracted_value !== undefined) {
    console.log(`         Extracted value: ${r.extracted_value}`);
  }
}

console.log(`\nOverall: ${result.all_passed ? "APPROVED" : "REJECTED"}`);

if (result.all_passed) {
  console.log(`\nHTLC preimage released: ${result.preimage?.slice(0, 16)}...`);
  console.log("Claimant can now redeem their Cashu HTLC token.");
}

// ---------------------------------------------------------------------------
// Step 4: Cashu HTLC Escrow Flow
// ---------------------------------------------------------------------------

separator("Step 4: Cashu HTLC Escrow Flow");

console.log("The token distribution uses Anchr's 2-phase HTLC pattern (NUT-14):\n");

console.log("Phase 1: Project locks tokens in escrow");
console.log("  - Project creates Cashu proofs for the total budget");
console.log("  - Each claim gets a unique hash/preimage pair");
console.log("  - Oracle holds the preimage");
console.log("  - Proofs are held by the project (plain bearer instruments)");
console.log();
console.log("  In code (reference: src/infrastructure/cashu/escrow.ts):");
console.log("  ```");
console.log("  // Phase 1: Create hold token");
console.log("  const holdToken = await createHtlcToken(");
console.log(`    ${criteria.token_amount_per_claim}, // amount per claim`);
console.log("    { hash, requesterPubkey: projectPubkey, locktimeSeconds },");
console.log("    sourceProofs,");
console.log("  );");
console.log("  ```");
console.log();

console.log("Phase 2: After claimant submits valid proofs, bind to claimant");
console.log("  - Oracle verifies all TLSNotary conditions (Step 3 above)");
console.log("  - Project swaps plain proofs for HTLC-locked proofs:");
console.log("    hashlock(hash) + P2PK(claimant) + locktime + refund(project)");
console.log("  - Oracle releases preimage to claimant via NIP-44 DM");
console.log();
console.log("  In code:");
console.log("  ```");
console.log("  // Phase 2: Bind to claimant after verification");
console.log("  const htlcToken = await swapHtlcBindWorker(holdToken.proofs, {");
console.log("    hash,");
console.log("    workerPubkey: claimantPubkey,");
console.log("    requesterRefundPubkey: projectPubkey,");
console.log("    locktimeSeconds,");
console.log("  });");
console.log("  ```");
console.log();

console.log("Redemption: Claimant redeems with preimage + signature");
console.log("  - Claimant receives preimage from oracle");
console.log("  - Signs the HTLC proof with their private key");
console.log("  - Swaps on the Cashu mint for fresh, unlocked proofs");
console.log();
console.log("  In code:");
console.log("  ```");
console.log("  // Claimant redeems");
console.log("  const redeemed = await redeemHtlcToken(");
console.log("    htlcToken.proofs,");
console.log("    preimage,");
console.log("    claimantPrivateKey,");
console.log("  );");
console.log(`  // redeemed.amountSats === ${criteria.token_amount_per_claim}`);
console.log("  ```");

// ---------------------------------------------------------------------------
// Step 5: Demonstrate Rejection
// ---------------------------------------------------------------------------

separator("Step 5: Demonstrate Rejection (Bot Account)");

console.log("Simulating a claim from a fresh bot account...\n");

const mockBotResponse: GitHubUserResponse = {
  login: "bot-farmer-3847",
  id: 99999999,
  created_at: "2026-03-20T00:00:00Z", // 15 days old
  public_repos: 2,
  public_gists: 0,
  followers: 0,
  following: 0,
};

console.log("Mock GitHub API response (bot account):");
console.log(indent(JSON.stringify(mockBotResponse, null, 2)));

const botVerifiedData: VerifiedProofData = {
  server_name: "api.github.com",
  revealed_body: JSON.stringify(mockBotResponse),
  session_timestamp: now - 45,
};

const botProofs = new Map<number, VerifiedProofData>();
botProofs.set(0, botVerifiedData);
botProofs.set(1, botVerifiedData);
botProofs.set(2, botVerifiedData);

const botPreimage = "0".repeat(64);
console.log("\nVerifying bot claim...\n");
const botResult = verifyClaim(criteria, botProofs, botPreimage);

for (const r of botResult.results) {
  const icon = r.passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${icon} ${r.reason}`);
  if (r.extracted_value !== undefined) {
    console.log(`         Extracted value: ${r.extracted_value}`);
  }
}

console.log(`\nOverall: ${botResult.all_passed ? "APPROVED" : "REJECTED"}`);
console.log("HTLC preimage: NOT released (conditions not met)");
console.log("Escrowed tokens remain locked and will be refunded to the project after locktime.");

// ---------------------------------------------------------------------------
// Step 6: Economic Analysis
// ---------------------------------------------------------------------------

separator("Step 6: Economic Analysis");

const claimValue = criteria.token_amount_per_claim;
const btcPrice = 90_000; // approximate BTC price in USD
const claimValueUsd = (claimValue / 100_000_000) * btcPrice;

console.log(`Claim value: ${claimValue.toLocaleString()} sats (~$${claimValueUsd.toFixed(2)} at $${btcPrice.toLocaleString()} BTC)\n`);

console.log("Cost to farm a qualifying fake account:");
console.log("  GitHub account > 365 days old:");
console.log("    - Buy aged GitHub account:    $50-100");
console.log("    - Risk of account suspension:  High (GitHub actively detects purchased accounts)");
console.log();
console.log("  GitHub > 10 public repos:");
console.log("    - Fork/create repos:           $5-10 (scripts exist, but easily detected)");
console.log("    - Organic repo creation:        Months of effort");
console.log();
console.log("  GitHub > 5 contributions (gists):");
console.log("    - Create public gists:          $2-5");
console.log("    - Meaningful contributions:     Weeks of effort");
console.log();
console.log("  Combined farming cost:            $57-115+ per identity");
console.log(`  Airdrop reward:                   $${claimValueUsd.toFixed(2)} per claim`);
console.log();

if (claimValueUsd < 57) {
  console.log("  Result: UNPROFITABLE to farm at scale");
  console.log("  The combined cost of faking all conditions exceeds the airdrop reward.");
} else {
  console.log("  Result: Marginal profitability");
  console.log("  Consider adding more conditions (e.g., Twitter followers) to increase farming cost.");
}

console.log();
console.log("Adding Twitter follower requirement (>100 followers) would increase farming cost");
console.log("by an additional $50-150 per identity, making attacks even less economical.");

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

separator("Summary");

console.log("Airdrop Bot Shield uses Anchr's TLSNotary + Cashu HTLC stack to:");
console.log();
console.log("  1. PROVE real-world identity attributes without revealing identity");
console.log("     (TLSNotary cryptographic proofs of GitHub/Twitter API responses)");
console.log();
console.log("  2. DISTRIBUTE tokens trustlessly via Cashu HTLC escrow");
console.log("     (NUT-14 hashlock + P2PK, non-custodial, atomic settlement)");
console.log();
console.log("  3. RESIST Sybil attacks through economic cost barriers");
console.log("     (combined proof requirements make farming unprofitable)");
console.log();
console.log("For integration with the full Anchr server, see:");
console.log("  - src/domain/types.ts          (TlsnRequirement, HtlcInfo)");
console.log("  - src/infrastructure/verification/tlsn-validation.ts (proof verification)");
console.log("  - src/infrastructure/cashu/escrow.ts (HTLC token lifecycle)");
