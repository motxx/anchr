/**
 * Prediction Market Demo — N:M Conditional Swap
 *
 * Demonstrates the full lifecycle using the protocol layer:
 *
 *   1. Oracle creates dual-preimage pair (hash_yes / hash_no)
 *   2. Alice places YES order, Bob places NO order
 *   3. Order book matches them (FIFO, partial match support)
 *   4. Cross-HTLC tokens created for the matched pair
 *   5. Oracle resolves via TLSNotary → reveals winning preimage
 *   6. Winner redeems loser's tokens with the preimage
 *
 * Usage:
 *   deno run --allow-all example/prediction-market/src/demo.ts
 */

import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { createDualPreimageStore } from "../../../src/infrastructure/conditional-swap/dual-preimage-store.ts";
import {
  buildCrossHtlcForPartyA,
  buildCrossHtlcForPartyB,
} from "../../../src/infrastructure/conditional-swap/cross-htlc.ts";
import { createOrderBook } from "./order-book.ts";
import { resolveMarket as resolveMarketDual } from "./resolution.ts";
import {
  resolveMarket as resolveMarketOracle,
  evaluateCondition,
  extractJsonValue,
  calculatePayouts,
  calculateOracleFee,
} from "./market-oracle.ts";
import type {
  PredictionMarket,
  Bet,
  ResolutionCondition,
  OpenOrder,
} from "./market-types.ts";

// ============================================================
// Demo configuration
// ============================================================

const BITFLYER_API_URL = "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY";
const RESOLUTION_DEADLINE = Math.floor(Date.now() / 1000) + 86400; // 24h from now
const ORACLE_FEE_PPM = 5_000;  // 0.5%
const CREATOR_FEE_PPM = 10_000; // 1.0%

console.log("=== Bitcoin-Native Prediction Market Demo (N:M Conditional Swap) ===\n");
console.log("Powered by Anchr: Cross-HTLC Dual-Preimage + Nostr + TLSNotary\n");
console.log("\u2501".repeat(60));

// ============================================================
// Step 1: Oracle creates dual-preimage pair
// ============================================================

console.log("\n--- Step 1: Oracle creates dual-preimage pair ---\n");

const dualStore = createDualPreimageStore();
const marketId = bytesToHex(randomBytes(16));
const { hash_a: hashYes, hash_b: hashNo } = dualStore.create(marketId);

console.log(`  Market ID:      ${marketId}`);
console.log(`  Hash YES (A):   ${hashYes.slice(0, 16)}...`);
console.log(`  Hash NO  (B):   ${hashNo.slice(0, 16)}...`);
console.log(`  Two preimages generated — one for each outcome.`);
console.log(`  Oracle reveals only the winner's preimage; loser's is deleted forever.`);

// Simulated keypairs
const creatorPubkey = bytesToHex(randomBytes(32));
const oraclePubkey = bytesToHex(randomBytes(32));
const alicePubkey = bytesToHex(randomBytes(32));
const bobPubkey = bytesToHex(randomBytes(32));

// ============================================================
// Step 2: Market creation with dual hashes
// ============================================================

console.log("\n--- Step 2: Market creation with dual hashes ---\n");

const resolutionCondition: ResolutionCondition = {
  type: "jsonpath_gt",
  target_url: BITFLYER_API_URL,
  jsonpath: "best_bid",
  threshold: 11_000_000,
  description: "BTC/JPY best bid price must be above 11,000,000",
};

const market: PredictionMarket = {
  id: marketId,
  title: "Will BTC/JPY be above \u00a511,000,000 on resolution date?",
  description: "Resolves YES if BTC/JPY best bid > \u00a511M on bitFlyer. TLSNotary verified.",
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
  htlc_hash_yes: hashYes,
  htlc_hash_no: hashNo,

  nostr_event_id: bytesToHex(randomBytes(32)),
  status: "open",
};

console.log(`  Title:          ${market.title}`);
console.log(`  Hash YES:       ${hashYes.slice(0, 16)}...`);
console.log(`  Hash NO:        ${hashNo.slice(0, 16)}...`);
console.log(`  Deadline:       ${new Date(RESOLUTION_DEADLINE * 1000).toISOString()}`);

// ============================================================
// Step 3: Bettors place orders via order book
// ============================================================

console.log("\n--- Step 3: Bettors place orders via order book ---\n");

const orderBook = createOrderBook();

const aliceOrder: OpenOrder = {
  id: bytesToHex(randomBytes(16)),
  market_id: marketId,
  bettor_pubkey: alicePubkey,
  side: "yes",
  amount_sats: 100,
  remaining_sats: 100,
  timestamp: Math.floor(Date.now() / 1000),
};

const bobOrder: OpenOrder = {
  id: bytesToHex(randomBytes(16)),
  market_id: marketId,
  bettor_pubkey: bobPubkey,
  side: "no",
  amount_sats: 100,
  remaining_sats: 100,
  timestamp: Math.floor(Date.now() / 1000),
};

orderBook.addOrder(aliceOrder);
orderBook.addOrder(bobOrder);

console.log("  Alice (YES): 100 sats");
console.log("  Bob   (NO):  100 sats");
console.log(`  Open orders: ${orderBook.getOpenOrders(marketId).length}`);

// ============================================================
// Step 4: Order book matches → Cross-HTLC
// ============================================================

console.log("\n--- Step 4: Order book matching + Cross-HTLC ---\n");

const matches = orderBook.matchOrders(marketId);
console.log(`  Matches found: ${matches.length}`);

for (const m of matches) {
  console.log(`  Match: YES(${m.yes_order_id.slice(0, 8)}...) <-> NO(${m.no_order_id.slice(0, 8)}...) = ${m.amount_sats} sats`);
}

// Build cross-HTLC P2PK options (simulated — real version calls createSwapPairTokens)
console.log("\n  Cross-HTLC token structure:");

const optionsAtoB = buildCrossHtlcForPartyA({
  hash_b: hashNo,
  counterpartyPubkey: bobPubkey,
  refundPubkey: alicePubkey,
  locktime: RESOLUTION_DEADLINE,
});

const optionsBtoA = buildCrossHtlcForPartyB({
  hash_a: hashYes,
  counterpartyPubkey: alicePubkey,
  refundPubkey: bobPubkey,
  locktime: RESOLUTION_DEADLINE,
});

console.log(`  token_yes_to_no (Alice's sats):`);
console.log(`    hashlock:  hash_no  → Bob redeems if NO wins`);
console.log(`    P2PK:      Bob's pubkey`);
console.log(`    refund:    Alice (after locktime)`);
console.log(`  token_no_to_yes (Bob's sats):`);
console.log(`    hashlock:  hash_yes → Alice redeems if YES wins`);
console.log(`    P2PK:      Alice's pubkey`);
console.log(`    refund:    Bob (after locktime)`);

market.yes_pool_sats = 100;
market.no_pool_sats = 100;

// Create simulated bets for payout calculation
const aliceBet: Bet = {
  id: aliceOrder.id,
  market_id: marketId,
  bettor_pubkey: alicePubkey,
  side: "yes",
  amount_sats: 100,
  escrow_token: "(cross-htlc-token)",
  timestamp: aliceOrder.timestamp,
};

const bobBet: Bet = {
  id: bobOrder.id,
  market_id: marketId,
  bettor_pubkey: bobPubkey,
  side: "no",
  amount_sats: 100,
  escrow_token: "(cross-htlc-token)",
  timestamp: bobOrder.timestamp,
};

// ============================================================
// Step 5: Oracle resolves via TLSNotary + dual-preimage
// ============================================================

console.log("\n--- Step 5: Oracle resolves market ---\n");

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
  ltp: 14_852_000,
  volume: 3456.78,
  volume_by_product: 3456.78,
});

const parsed = JSON.parse(mockBitflyerResponse);
console.log("  TLSNotary proof captures:");
console.log(`    best_bid: ${parsed.best_bid.toLocaleString()}`);
console.log(`    ltp:      ${parsed.ltp.toLocaleString()}`);

const conditionMet = evaluateCondition(resolutionCondition, mockBitflyerResponse);
const outcome = conditionMet ? "yes" : "no";
console.log(`\n  Condition: best_bid > 11,000,000 → ${conditionMet ? "MET" : "NOT MET"}`);
console.log(`  Outcome:   ${outcome.toUpperCase()}`);

// Dual-preimage reveal — the core of N:M conditional swap
console.log("\n  Dual-preimage reveal:");

const resolution = resolveMarketDual(marketId, outcome as "yes" | "no", dualStore);
if (resolution) {
  console.log(`  Winning preimage (${resolution.outcome.toUpperCase()}): ${resolution.preimage.slice(0, 16)}...`);
  console.log(`  Losing preimage: PERMANENTLY DELETED`);

  // Verify the losing preimage is gone
  const tryRevealAgain = dualStore.reveal(marketId, outcome === "yes" ? "a" : "b");
  console.log(`  Second reveal attempt: ${tryRevealAgain === null ? "null (correctly rejected)" : "ERROR: should be null"}`);
} else {
  console.log("  ERROR: Resolution failed");
}

// ============================================================
// Step 6: Winner redeems via preimage
// ============================================================

console.log("\n--- Step 6: Payout distribution ---\n");

const totalPool = market.yes_pool_sats + market.no_pool_sats;
const oracleFee = calculateOracleFee(totalPool, ORACLE_FEE_PPM);
const creatorFee = calculateOracleFee(totalPool, CREATOR_FEE_PPM);

console.log(`  Total pool:    ${totalPool} sats`);
console.log(`  Oracle fee:    ${oracleFee} sats`);
console.log(`  Creator fee:   ${creatorFee} sats`);
console.log(`  Payable pool:  ${totalPool - oracleFee - creatorFee} sats`);

const allBets = [
  { side: aliceBet.side, amount_sats: aliceBet.amount_sats, bettor_pubkey: aliceBet.bettor_pubkey },
  { side: bobBet.side, amount_sats: bobBet.amount_sats, bettor_pubkey: bobBet.bettor_pubkey },
];

const payouts = calculatePayouts(market, outcome as "yes" | "no", allBets, ORACLE_FEE_PPM);

console.log();
if (outcome === "yes") {
  console.log("  YES wins! Alice redeems Bob's cross-HTLC tokens with preimage_yes.");
  console.log("  Flow: Alice calls redeemHtlcToken(bobsProofs, preimage_yes, alicePrivKey)");
} else {
  console.log("  NO wins! Bob redeems Alice's cross-HTLC tokens with preimage_no.");
  console.log("  Flow: Bob calls redeemHtlcToken(alicesProofs, preimage_no, bobPrivKey)");
}

console.log("\n  Payouts:");
for (const p of payouts) {
  const name = p.bettor_pubkey === alicePubkey ? "Alice" : "Bob";
  console.log(`    ${name}: ${p.payout_sats} sats`);
}

// ============================================================
// Summary
// ============================================================

console.log("\n" + "\u2501".repeat(60));
console.log("\n--- Summary ---\n");

console.log(`  Market:       ${market.title}`);
console.log(`  BTC/JPY:      \u00a5${parsed.best_bid.toLocaleString()}`);
console.log(`  Outcome:      ${outcome.toUpperCase()}`);
console.log();
console.log("  Protocol layer (N:M Conditional Swap):");
console.log("    - DualPreimageStore: 2 preimages per swap, winner revealed, loser deleted");
console.log("    - Cross-HTLC: dual-direction hashlock, opposite-side redemption");
console.log("    - Order book: FIFO matching with partial fills");
console.log("    - 1:1 atomic swap is the N=1, M=1 special case");
console.log();
console.log("  Why this beats Polymarket:");
console.log("    - No Polygon. No USDC. No bridges. Just sats.");
console.log("    - No KYC. No CFTC. No geoblocking. Just Nostr keys.");
console.log("    - No UMA token voters. No 48h dispute window. Just math.");
console.log("    - 1 sat minimum bet. Casual markets Polymarket can't touch.");
