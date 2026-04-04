/**
 * Prediction Market Demo
 *
 * Simulates the full lifecycle of a Bitcoin-native prediction market:
 *
 *   1. Market creation: "Will BTC/JPY be above 11,000,000 on resolution date?"
 *   2. Resolution URL: https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY
 *   3. Two bettors: Alice bets YES (100 sats), Bob bets NO (100 sats)
 *   4. HTLC escrow mechanics for both sides
 *   5. Oracle resolves via TLSNotary proof of bitFlyer API
 *   6. Payout distribution
 *
 * Usage:
 *   deno run --allow-all example/prediction-market/src/demo.ts
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import {
  createMarketHtlc,
  resolveMarket,
  evaluateCondition,
  extractJsonValue,
  calculatePayouts,
  calculateOracleFee,
  verifyPreimage,
} from "./market-oracle.ts";
import type {
  PredictionMarket,
  Bet,
  MarketResolution,
  ResolutionCondition,
} from "./market-types.ts";

// ============================================================
// Demo configuration
// ============================================================

const BITFLYER_API_URL = "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY";
const RESOLUTION_DEADLINE = Math.floor(Date.now() / 1000) + 86400; // 24h from now
const ORACLE_FEE_PPM = 5_000;  // 0.5%
const CREATOR_FEE_PPM = 10_000; // 1.0%

// ============================================================
// Step 1: Oracle generates HTLC keypair
// ============================================================

console.log("=== Bitcoin-Native Prediction Market Demo ===\n");
console.log("Powered by Anchr: Cashu HTLC + Nostr + TLSNotary\n");
console.log("━".repeat(60));

console.log("\n--- Step 1: Oracle generates HTLC keypair ---\n");

const htlc = createMarketHtlc();
console.log(`  Preimage (secret):  ${htlc.preimage.slice(0, 16)}...`);
console.log(`  Hash (public):      ${htlc.hash.slice(0, 16)}...`);
console.log(`  Preimage verified:  ${verifyPreimage(htlc.preimage, htlc.hash)}`);

// Simulated keypairs (in production, derived from Nostr identities)
const creatorPubkey = bytesToHex(randomBytes(32));
const oraclePubkey = bytesToHex(randomBytes(32));
const alicePubkey = bytesToHex(randomBytes(32));
const bobPubkey = bytesToHex(randomBytes(32));

// ============================================================
// Step 2: Market creator publishes market
// ============================================================

console.log("\n--- Step 2: Market creator publishes market ---\n");

const resolutionCondition: ResolutionCondition = {
  type: "jsonpath_gt",
  target_url: BITFLYER_API_URL,
  jsonpath: "best_bid",
  threshold: 11_000_000,
  description: "BTC/JPY best bid price must be above 11,000,000",
};

const market: PredictionMarket = {
  id: bytesToHex(randomBytes(16)),
  title: "Will BTC/JPY be above \u00a511,000,000 on resolution date?",
  description: [
    "Resolves YES if the BTC/JPY best bid price on bitFlyer is above",
    "\u00a511,000,000 at the time of resolution. Resolved by TLSNotary proof",
    "of the bitFlyer public ticker API. No registration required.",
  ].join(" "),
  category: "crypto",
  creator_pubkey: creatorPubkey,

  resolution_url: BITFLYER_API_URL,
  resolution_condition: resolutionCondition,
  resolution_deadline: RESOLUTION_DEADLINE,

  yes_pool_sats: 0,
  no_pool_sats: 0,
  min_bet_sats: 1,
  max_bet_sats: 1_000_000,
  fee_ppm: CREATOR_FEE_PPM,

  oracle_pubkey: oraclePubkey,
  htlc_hash: htlc.hash,

  nostr_event_id: bytesToHex(randomBytes(32)),
  status: "open",
};

console.log(`  Market ID:     ${market.id}`);
console.log(`  Title:         ${market.title}`);
console.log(`  Category:      ${market.category}`);
console.log(`  Resolution:    ${market.resolution_url}`);
console.log(`  Condition:     ${resolutionCondition.description}`);
console.log(`  Deadline:      ${new Date(RESOLUTION_DEADLINE * 1000).toISOString()}`);
console.log(`  Min bet:       ${market.min_bet_sats} sat`);
console.log(`  Creator fee:   ${CREATOR_FEE_PPM / 10_000}%`);
console.log(`  Oracle fee:    ${ORACLE_FEE_PPM / 10_000}%`);
console.log();
console.log("  [Nostr] Published as kind 30078 event to relays");
console.log("  [Nostr] Tags: #t=anchr-prediction-market, #t=anchr-pm-crypto");

// ============================================================
// Step 3: Bettors place bets via HTLC escrow
// ============================================================

console.log("\n--- Step 3: Bettors place bets ---\n");

// Alice bets YES (100 sats)
const aliceBet: Bet = {
  id: bytesToHex(randomBytes(16)),
  market_id: market.id,
  bettor_pubkey: alicePubkey,
  side: "yes",
  amount_sats: 100,
  cashu_token: "cashuA...(HTLC-locked-token)...",
  timestamp: Math.floor(Date.now() / 1000),
};

// Bob bets NO (100 sats)
const bobBet: Bet = {
  id: bytesToHex(randomBytes(16)),
  market_id: market.id,
  bettor_pubkey: bobPubkey,
  side: "no",
  amount_sats: 100,
  cashu_token: "cashuA...(HTLC-locked-token)...",
  timestamp: Math.floor(Date.now() / 1000),
};

// Update pools
market.yes_pool_sats += aliceBet.amount_sats;
market.no_pool_sats += bobBet.amount_sats;

console.log("  Alice (YES bettor):");
console.log(`    Pubkey:  ${alicePubkey.slice(0, 16)}...`);
console.log(`    Side:    YES`);
console.log(`    Amount:  ${aliceBet.amount_sats} sats`);
console.log(`    HTLC:    hashlock(${htlc.hash.slice(0, 16)}...) + P2PK(Alice)`);
console.log(`    Escrow:  Cashu token locked — redeemable with preimage + Alice signature`);
console.log();
console.log("  Bob (NO bettor):");
console.log(`    Pubkey:  ${bobPubkey.slice(0, 16)}...`);
console.log(`    Side:    NO`);
console.log(`    Amount:  ${bobBet.amount_sats} sats`);
console.log(`    HTLC:    hashlock(${htlc.hash.slice(0, 16)}...) + locktime(${new Date(RESOLUTION_DEADLINE * 1000).toISOString()})`);
console.log(`    Escrow:  Cashu token locked — refundable after locktime if NO wins`);
console.log();
console.log("  Pool totals:");
console.log(`    YES pool: ${market.yes_pool_sats} sats`);
console.log(`    NO pool:  ${market.no_pool_sats} sats`);
console.log(`    Total:    ${market.yes_pool_sats + market.no_pool_sats} sats`);

// ============================================================
// Step 4: HTLC escrow mechanics explained
// ============================================================

console.log("\n--- Step 4: HTLC escrow mechanics ---\n");

console.log("  YES bets use HTLC with Oracle's hash:");
console.log("    Spending condition: preimage + bettor_signature");
console.log("    If YES wins -> Oracle reveals preimage -> YES bettors redeem");
console.log("    If NO wins  -> HTLC locktime expires -> tokens refund to NO payout pool");
console.log();
console.log("  NO bets use time-locked HTLC:");
console.log("    Spending condition: locktime_expired OR (preimage + bettor_signature)");
console.log("    If NO wins  -> Locktime expires -> NO bettors claim proportional share");
console.log("    If YES wins -> Tokens redistributed to YES winners via preimage reveal");
console.log();
console.log("  This design uses Anchr's existing NUT-14 HTLC infrastructure:");
console.log("    - Phase 1: Plain proofs held by market contract (before bettor known)");
console.log("    - Phase 2: hashlock(hash) + P2PK(bettor) + locktime + refund(market)");
console.log("    - Redemption: bettor provides preimage + signature to mint");

// ============================================================
// Step 5: Oracle resolution via TLSNotary
// ============================================================

console.log("\n--- Step 5: Oracle resolves market via TLSNotary ---\n");

// Simulate the bitFlyer API response
// Real response format: https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY
const mockBitflyerResponse = JSON.stringify({
  product_code: "BTC_JPY",
  state: "RUNNING",
  timestamp: new Date().toISOString(),
  tick_id: 12345678,
  best_bid: 14_850_000,
  best_ask: 14_855_000,
  best_bid_size: 0.5,
  best_ask_size: 0.3,
  total_bid_depth: 1250.5,
  total_ask_depth: 980.3,
  market_bid_size: 0,
  market_ask_size: 0,
  ltp: 14_852_000,
  volume: 3456.78,
  volume_by_product: 3456.78,
});

console.log("  Oracle fetches bitFlyer API via TLSNotary MPC-TLS session...");
console.log(`  URL: ${BITFLYER_API_URL}`);
console.log();
console.log("  TLSNotary proof captures:");
console.log(`    Server name: api.bitflyer.com (from TLS certificate)`);
console.log(`    Response body (selective disclosure):`);

const parsed = JSON.parse(mockBitflyerResponse);
console.log(`      product_code: "${parsed.product_code}"`);
console.log(`      best_bid:     ${parsed.best_bid.toLocaleString()}`);
console.log(`      best_ask:     ${parsed.best_ask.toLocaleString()}`);
console.log(`      ltp:          ${parsed.ltp.toLocaleString()}`);
console.log(`      timestamp:    ${parsed.timestamp}`);

// Evaluate the condition
console.log();
console.log("  Evaluating resolution condition:");
console.log(`    Condition: best_bid > 11,000,000`);

const extractedValue = extractJsonValue(mockBitflyerResponse, "best_bid");
console.log(`    Extracted: best_bid = ${extractedValue}`);

const conditionMet = evaluateCondition(resolutionCondition, mockBitflyerResponse);
console.log(`    Result:    ${conditionMet ? "YES (condition met)" : "NO (condition not met)"}`);

// Perform resolution
const mockTlsnProof = btoa("mock-tlsn-presentation-" + Date.now());
const now = Math.floor(Date.now() / 1000);

const resolution: MarketResolution = resolveMarket(
  market,
  mockTlsnProof,
  "api.bitflyer.com",
  mockBitflyerResponse,
  now,
  htlc.preimage,
);

console.log();
console.log(`  Resolution outcome: ${resolution.outcome.toUpperCase()}`);
if (resolution.preimage) {
  console.log(`  Preimage revealed:  ${resolution.preimage.slice(0, 16)}...`);
}

// ============================================================
// Step 6: Payout distribution
// ============================================================

console.log("\n--- Step 6: Payout distribution ---\n");

const totalPool = market.yes_pool_sats + market.no_pool_sats;
const oracleFee = calculateOracleFee(totalPool, ORACLE_FEE_PPM);
const creatorFee = calculateOracleFee(totalPool, CREATOR_FEE_PPM);

console.log(`  Total pool:    ${totalPool} sats`);
console.log(`  Oracle fee:    ${oracleFee} sats (${ORACLE_FEE_PPM / 10_000}%)`);
console.log(`  Creator fee:   ${creatorFee} sats (${CREATOR_FEE_PPM / 10_000}%)`);
console.log(`  Payable pool:  ${totalPool - oracleFee - creatorFee} sats`);
console.log();

const allBets = [
  { side: aliceBet.side, amount_sats: aliceBet.amount_sats, bettor_pubkey: aliceBet.bettor_pubkey },
  { side: bobBet.side, amount_sats: bobBet.amount_sats, bettor_pubkey: bobBet.bettor_pubkey },
];

const payouts = calculatePayouts(market, resolution.outcome, allBets, ORACLE_FEE_PPM);

if (resolution.outcome === "yes") {
  console.log("  YES wins! Oracle reveals preimage -> YES bettors redeem HTLC tokens.");
  console.log();
  console.log("  Redemption flow:");
  console.log("    1. Oracle publishes preimage to Nostr (kind 30078 resolution event)");
  console.log("    2. Alice sees preimage in the resolution event");
  console.log("    3. Alice provides preimage + her signature to the Cashu mint");
  console.log("    4. Mint verifies HTLC spending conditions (NUT-14)");
  console.log("    5. Mint swaps HTLC proofs for fresh, unlocked proofs");
  console.log();
  console.log("  Bob's NO tokens:");
  console.log("    - HTLC locktime has not expired yet (deadline not reached)");
  console.log("    - But with preimage now public, market contract can redistribute");
  console.log("    - Bob's tokens are swept into the YES winner payout pool");
} else {
  console.log("  NO wins! HTLC locktime expires -> NO bettors claim from refund pool.");
  console.log();
  console.log("  Redemption flow:");
  console.log("    1. Oracle publishes resolution (no preimage) to Nostr");
  console.log("    2. Resolution deadline passes, HTLC locktime expires");
  console.log("    3. Bob's NO tokens become refundable from the locktime expiry");
  console.log("    4. Alice's YES tokens also expire (no preimage to redeem)");
  console.log("    5. Market contract redistributes all expired tokens to NO bettors");
}

console.log();
console.log("  Payouts:");
for (const payout of payouts) {
  const name = payout.bettor_pubkey === alicePubkey ? "Alice" : "Bob";
  console.log(`    ${name}: ${payout.payout_sats} sats`);
}
if (payouts.length === 0) {
  console.log("    (No winning bets)");
}

// ============================================================
// Step 7: Summary
// ============================================================

console.log("\n" + "━".repeat(60));
console.log("\n--- Summary ---\n");

console.log("  Market:     " + market.title);
console.log("  Source:     bitFlyer API (TLSNotary verified)");
console.log(`  BTC/JPY:    \u00a5${parsed.best_bid.toLocaleString()}`);
console.log(`  Threshold:  \u00a5${resolutionCondition.threshold?.toLocaleString()}`);
console.log(`  Outcome:    ${resolution.outcome.toUpperCase()}`);
console.log();
console.log("  Technology stack:");
console.log("    Escrow:     Cashu HTLC (NUT-14) on Lightning");
console.log("    Discovery:  Nostr kind 30078 events");
console.log("    Oracle:     TLSNotary proof from api.bitflyer.com");
console.log("    Settlement: Preimage reveal for YES / locktime expiry for NO");
console.log();
console.log("  Why this beats Polymarket:");
console.log("    - No Polygon. No USDC. No bridges. Just sats.");
console.log("    - No KYC. No CFTC. No geoblocking. Just Nostr keys.");
console.log("    - No UMA token voters. No 48h dispute window. Just math.");
console.log("    - 1 sat minimum bet. Casual markets Polymarket can't touch.");
console.log();
console.log("  Learn more: https://github.com/motxx/anchr");
