/**
 * E2E: TLSNotary -> Market Resolution flow for prediction markets.
 *
 * Tests the full oracle resolution pipeline with a mock TLSNotary proof
 * and real bitFlyer API data. Does NOT require Docker or Rust binaries --
 * uses plain HTTP fetch to bitFlyer (public API, no auth) and exercises
 * both resolution paths:
 *
 *   1. market-oracle.ts  resolveMarket  (condition evaluation + preimage gate)
 *   2. resolution.ts     resolveMarket  (dual-preimage reveal via DualPreimageStore)
 *
 * Run:
 *   deno test e2e/prediction-market-resolution.test.ts --allow-all
 */

import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { createDualPreimageStore } from "../src/infrastructure/conditional-swap/dual-preimage-store.ts";
import { resolveMarket as resolveMarketDual } from "../example/prediction-market/src/resolution.ts";
import {
  resolveMarket as resolveMarketOracle,
  evaluateCondition,
  extractJsonValue,
  calculatePayouts,
  calculateOracleFee,
  verifyPreimage,
  OracleError,
} from "../example/prediction-market/src/market-oracle.ts";
import type {
  PredictionMarket,
  ResolutionCondition,
} from "../example/prediction-market/src/market-types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BITFLYER_URL =
  "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY";
const BITFLYER_HOST = "api.bitflyer.com";

const ORACLE_FEE_PPM = 5_000; // 0.5%
const CREATOR_FEE_PPM = 10_000; // 1.0%

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a preimage / SHA-256 hash pair. */
function makePreimage(): { preimage: string; hash: string } {
  const raw = randomBytes(32);
  return { preimage: bytesToHex(raw), hash: bytesToHex(sha256(raw)) };
}

/** Build a PredictionMarket with sensible defaults. */
function makeMarket(
  overrides: Partial<PredictionMarket> = {},
): PredictionMarket {
  const { hash: hashYes } = makePreimage();
  const { hash: hashNo } = makePreimage();
  return {
    id: bytesToHex(randomBytes(16)),
    title: "Will BTC/JPY exceed threshold?",
    description: "E2E test market",
    category: "crypto",
    creator_pubkey: bytesToHex(randomBytes(32)),
    resolution_url: BITFLYER_URL,
    resolution_condition: {
      type: "jsonpath_gt",
      target_url: BITFLYER_URL,
      jsonpath: "best_bid",
      // Use a threshold that is almost certainly below real BTC/JPY
      threshold: 100_000,
      description: "BTC/JPY best_bid > 100,000",
    },
    resolution_deadline: Math.floor(Date.now() / 1000) + 86400,
    yes_pool_sats: 500,
    no_pool_sats: 500,
    min_bet_sats: 1,
    max_bet_sats: 1_000_000,
    fee_ppm: CREATOR_FEE_PPM,
    oracle_pubkey: bytesToHex(randomBytes(32)),
    htlc_hash_yes: hashYes,
    htlc_hash_no: hashNo,
    nostr_event_id: bytesToHex(randomBytes(32)),
    status: "open",
    ...overrides,
  } as PredictionMarket;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Prediction Market Resolution E2E", () => {
  let bitflyerReachable = false;
  let bitflyerBody = "";
  let bitflyerJson: Record<string, unknown> = {};

  beforeAll(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(BITFLYER_URL, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        bitflyerBody = await res.text();
        bitflyerJson = JSON.parse(bitflyerBody);
        bitflyerReachable = true;
      }
    } catch {
      console.warn(
        "[e2e] bitFlyer API unreachable -- tests that need live data will be skipped",
      );
    }
  });

  // =========================================================================
  // 1. evaluateCondition with real bitFlyer data
  // =========================================================================

  test("evaluateCondition: jsonpath_gt against live bitFlyer response", () => {
    if (!bitflyerReachable) {
      console.warn("[e2e] SKIPPED -- bitFlyer unreachable");
      return;
    }

    // The threshold 100,000 JPY is far below any realistic BTC/JPY price,
    // so the condition should evaluate to YES.
    const condition: ResolutionCondition = {
      type: "jsonpath_gt",
      target_url: BITFLYER_URL,
      jsonpath: "best_bid",
      threshold: 100_000,
      description: "BTC/JPY best_bid > 100,000",
    };
    const result = evaluateCondition(condition, bitflyerBody);
    expect(result).toBe(true);

    const bestBid = extractJsonValue(bitflyerBody, "best_bid") as number;
    expect(typeof bestBid).toBe("number");
    expect(bestBid).toBeGreaterThan(100_000);
    console.log(`  [live] best_bid = ${bestBid.toLocaleString()}`);
  });

  test("evaluateCondition: price_below against live bitFlyer response", () => {
    if (!bitflyerReachable) {
      console.warn("[e2e] SKIPPED -- bitFlyer unreachable");
      return;
    }

    // Use an absurdly high threshold so this evaluates to YES (below)
    const condition: ResolutionCondition = {
      type: "price_below",
      target_url: BITFLYER_URL,
      jsonpath: "best_bid",
      threshold: 999_999_999_999,
      description: "BTC/JPY best_bid < 999T",
    };
    expect(evaluateCondition(condition, bitflyerBody)).toBe(true);
  });

  test("evaluateCondition: contains_text against live bitFlyer response", () => {
    if (!bitflyerReachable) {
      console.warn("[e2e] SKIPPED -- bitFlyer unreachable");
      return;
    }

    const condition: ResolutionCondition = {
      type: "contains_text",
      target_url: BITFLYER_URL,
      expected_text: "BTC_JPY",
      description: 'Body contains "BTC_JPY"',
    };
    expect(evaluateCondition(condition, bitflyerBody)).toBe(true);
  });

  // =========================================================================
  // 2. resolveMarketOracle (market-oracle.ts) -- happy path
  // =========================================================================

  test("resolveMarketOracle produces valid YES resolution with live data", () => {
    if (!bitflyerReachable) {
      console.warn("[e2e] SKIPPED -- bitFlyer unreachable");
      return;
    }

    const { preimage, hash } = makePreimage();
    const market = makeMarket({
      htlc_hash_yes: hash,
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: BITFLYER_URL,
        jsonpath: "best_bid",
        threshold: 100_000,
        description: "BTC/JPY best_bid > 100,000",
      },
    });

    const now = Math.floor(Date.now() / 1000);
    const mockProof = btoa("mock-tlsn-proof-" + now);

    const resolution = resolveMarketOracle(
      market,
      mockProof,
      BITFLYER_HOST,
      bitflyerBody,
      now,
      preimage,
    );

    expect(resolution.market_id).toBe(market.id);
    expect(resolution.outcome).toBe("yes");
    expect(resolution.preimage).toBe(preimage);
    expect(resolution.tlsn_proof).toBe(mockProof);
    expect(resolution.verified_data.server_name).toBe(BITFLYER_HOST);
    expect(resolution.verified_data.revealed_body).toBe(bitflyerBody);
    expect(resolution.verified_data.timestamp).toBe(now);
    console.log(`  [oracle] resolved market ${market.id.slice(0, 8)}... -> YES`);
  });

  test("resolveMarketOracle produces NO when condition not met", () => {
    if (!bitflyerReachable) {
      console.warn("[e2e] SKIPPED -- bitFlyer unreachable");
      return;
    }

    const { preimage, hash } = makePreimage();
    // Threshold so high it cannot be met by real BTC/JPY
    const market = makeMarket({
      htlc_hash_yes: hash,
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: BITFLYER_URL,
        jsonpath: "best_bid",
        threshold: 999_999_999_999,
        description: "BTC/JPY best_bid > 999T (impossible)",
      },
    });

    const now = Math.floor(Date.now() / 1000);
    const resolution = resolveMarketOracle(
      market,
      btoa("proof"),
      BITFLYER_HOST,
      bitflyerBody,
      now,
      preimage,
    );

    expect(resolution.outcome).toBe("no");
    // Preimage must NOT be revealed for NO outcome
    expect(resolution.preimage).toBeUndefined();
    console.log(`  [oracle] resolved -> NO (preimage withheld)`);
  });

  // =========================================================================
  // 3. DualPreimageStore + resolution.ts -- preimage reveal lifecycle
  // =========================================================================

  test("dual preimage store: create, resolve YES, verify winning preimage matches hash", () => {
    const dualStore = createDualPreimageStore();
    const marketId = bytesToHex(randomBytes(16));
    const { hash_a: hashYes, hash_b: hashNo } = dualStore.create(marketId);

    // hash_a corresponds to YES, hash_b to NO
    expect(hashYes).toBeTruthy();
    expect(hashNo).toBeTruthy();
    expect(hashYes).not.toBe(hashNo);

    // Resolve YES -> reveals preimage_a
    const result = resolveMarketDual(marketId, "yes", dualStore);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("yes");
    expect(result!.preimage).toBeTruthy();
    expect(result!.preimage.length).toBe(64); // 32 bytes hex

    // Verify the revealed preimage hashes to hash_a (hash_yes)
    expect(verifyPreimage(result!.preimage, hashYes)).toBe(true);
    // It must NOT match hash_b (hash_no)
    expect(verifyPreimage(result!.preimage, hashNo)).toBe(false);

    console.log(`  [dual] YES preimage verified against hash_yes`);
  });

  test("dual preimage store: resolve NO, verify winning preimage matches hash_no", () => {
    const dualStore = createDualPreimageStore();
    const marketId = bytesToHex(randomBytes(16));
    const { hash_a: hashYes, hash_b: hashNo } = dualStore.create(marketId);

    // Resolve NO -> reveals preimage_b
    const result = resolveMarketDual(marketId, "no", dualStore);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("no");

    // Winning preimage matches hash_b (hash_no)
    expect(verifyPreimage(result!.preimage, hashNo)).toBe(true);
    // Must NOT match hash_a (hash_yes)
    expect(verifyPreimage(result!.preimage, hashYes)).toBe(false);

    console.log(`  [dual] NO preimage verified against hash_no`);
  });

  test("losing preimage is permanently deleted after resolution", () => {
    const dualStore = createDualPreimageStore();
    const marketId = bytesToHex(randomBytes(16));
    dualStore.create(marketId);

    // Resolve YES
    const result = resolveMarketDual(marketId, "yes", dualStore);
    expect(result).not.toBeNull();

    // Second reveal must fail -- store is marked as revealed
    const secondAttempt = dualStore.reveal(marketId, "a");
    expect(secondAttempt).toBeNull();

    // Trying to reveal the losing side also fails
    const losingAttempt = dualStore.reveal(marketId, "b");
    expect(losingAttempt).toBeNull();

    console.log(`  [dual] losing preimage irrecoverable -- confirmed`);
  });

  // =========================================================================
  // 4. Full pipeline: live fetch -> evaluate -> oracle resolve -> dual reveal
  // =========================================================================

  test("full pipeline: fetch bitFlyer -> oracle resolve -> dual preimage reveal -> payout", () => {
    if (!bitflyerReachable) {
      console.warn("[e2e] SKIPPED -- bitFlyer unreachable");
      return;
    }

    // --- Step 1: Create dual preimage store ---
    const dualStore = createDualPreimageStore();
    const marketId = bytesToHex(randomBytes(16));
    const { hash_a: hashYes, hash_b: hashNo } = dualStore.create(marketId);

    // --- Step 2: Build market with real bitFlyer URL ---
    const { preimage: oraclePreimage, hash: oracleHash } = makePreimage();
    const market = makeMarket({
      id: marketId,
      htlc_hash_yes: oracleHash,
      htlc_hash_no: hashNo,
      yes_pool_sats: 300,
      no_pool_sats: 200,
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: BITFLYER_URL,
        jsonpath: "best_bid",
        threshold: 100_000,
        description: "BTC/JPY best_bid > 100,000",
      },
    });

    // --- Step 3: Evaluate condition with real data ---
    const conditionMet = evaluateCondition(
      market.resolution_condition,
      bitflyerBody,
    );
    expect(conditionMet).toBe(true);

    // --- Step 4: Oracle resolution (market-oracle.ts) ---
    const now = Math.floor(Date.now() / 1000);
    const oracleResolution = resolveMarketOracle(
      market,
      btoa("mock-tlsn-proof"),
      BITFLYER_HOST,
      bitflyerBody,
      now,
      oraclePreimage,
    );

    expect(oracleResolution.outcome).toBe("yes");
    expect(oracleResolution.preimage).toBe(oraclePreimage);
    expect(oracleResolution.verified_data.server_name).toBe(BITFLYER_HOST);
    expect(oracleResolution.verified_data.revealed_body).toContain("BTC_JPY");

    // --- Step 5: Dual preimage reveal (resolution.ts) ---
    const outcome = oracleResolution.outcome;
    const dualResult = resolveMarketDual(marketId, outcome, dualStore);
    expect(dualResult).not.toBeNull();
    expect(dualResult!.outcome).toBe("yes");

    // The dual-store preimage for YES matches hash_a
    expect(verifyPreimage(dualResult!.preimage, hashYes)).toBe(true);

    // Losing preimage is gone forever
    expect(dualStore.reveal(marketId, "b")).toBeNull();
    expect(dualStore.reveal(marketId, "a")).toBeNull();

    // --- Step 6: Calculate payouts ---
    const bets = [
      { side: "yes" as const, amount_sats: 200, bettor_pubkey: "alice" },
      { side: "yes" as const, amount_sats: 100, bettor_pubkey: "carol" },
      { side: "no" as const, amount_sats: 200, bettor_pubkey: "bob" },
    ];

    const payouts = calculatePayouts(market, outcome, bets, ORACLE_FEE_PPM);

    // Only YES bettors should receive payouts
    expect(payouts.length).toBe(2);
    expect(payouts.every((p) => p.bettor_pubkey !== "bob")).toBe(true);

    const totalPool = market.yes_pool_sats + market.no_pool_sats;
    const oracleFee = calculateOracleFee(totalPool, ORACLE_FEE_PPM);
    const creatorFee = calculateOracleFee(totalPool, market.fee_ppm);
    const payablePool = totalPool - oracleFee - creatorFee;

    // Alice wagered 200/300 of the YES pool -> her share of the payable pool
    const alicePayout = payouts.find((p) => p.bettor_pubkey === "alice");
    expect(alicePayout).toBeTruthy();
    expect(alicePayout!.payout_sats).toBe(
      Math.floor((200 / 300) * payablePool),
    );

    // Carol wagered 100/300
    const carolPayout = payouts.find((p) => p.bettor_pubkey === "carol");
    expect(carolPayout).toBeTruthy();
    expect(carolPayout!.payout_sats).toBe(
      Math.floor((100 / 300) * payablePool),
    );

    // Fee sanity: oracle 0.5% + creator 1.0% = 1.5% of 500 = 7.5 -> ceil = 8
    expect(oracleFee).toBe(Math.ceil((totalPool * ORACLE_FEE_PPM) / 1_000_000));
    expect(creatorFee).toBe(
      Math.ceil((totalPool * CREATOR_FEE_PPM) / 1_000_000),
    );

    const totalPaid = payouts.reduce((s, p) => s + p.payout_sats, 0);
    // Total paid should be <= payable pool (rounding truncates)
    expect(totalPaid).toBeLessThanOrEqual(payablePool);
    expect(totalPaid).toBeGreaterThan(0);

    console.log(
      `  [pipeline] ${totalPool} sats pool | oracle fee ${oracleFee} | creator fee ${creatorFee}`,
    );
    console.log(
      `  [pipeline] payouts: alice=${alicePayout!.payout_sats}, carol=${carolPayout!.payout_sats}`,
    );
  });

  // =========================================================================
  // 5. Edge cases -- rejection scenarios
  // =========================================================================

  describe("edge cases", () => {
    test("rejects stale TLSNotary proof (timestamp too old)", () => {
      const { preimage, hash } = makePreimage();
      const market = makeMarket({ htlc_hash_yes: hash });

      // Timestamp from 1 hour ago -- exceeds 600s max age
      const staleTimestamp = Math.floor(Date.now() / 1000) - 3600;
      const body = JSON.stringify({ best_bid: 15_000_000 });

      expect(() => {
        resolveMarketOracle(
          market,
          btoa("proof"),
          BITFLYER_HOST,
          body,
          staleTimestamp,
          preimage,
        );
      }).toThrow(OracleError);

      // Verify the error message mentions staleness
      try {
        resolveMarketOracle(
          market,
          btoa("proof"),
          BITFLYER_HOST,
          body,
          staleTimestamp,
          preimage,
        );
      } catch (e) {
        expect((e as OracleError).message).toContain("too old");
      }
    });

    test("rejects server name mismatch", () => {
      const { preimage, hash } = makePreimage();
      const market = makeMarket({ htlc_hash_yes: hash });
      const now = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ best_bid: 15_000_000 });

      expect(() => {
        resolveMarketOracle(
          market,
          btoa("proof"),
          "evil.example.com", // Wrong server name
          body,
          now,
          preimage,
        );
      }).toThrow(OracleError);

      try {
        resolveMarketOracle(
          market,
          btoa("proof"),
          "evil.example.com",
          body,
          now,
          preimage,
        );
      } catch (e) {
        expect((e as OracleError).message).toContain("Server name mismatch");
      }
    });

    test("rejects preimage / hash mismatch", () => {
      const { hash } = makePreimage();
      const wrongPreimage = bytesToHex(randomBytes(32));
      const market = makeMarket({ htlc_hash_yes: hash });
      const now = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ best_bid: 15_000_000 });

      expect(() => {
        resolveMarketOracle(
          market,
          btoa("proof"),
          BITFLYER_HOST,
          body,
          now,
          wrongPreimage,
        );
      }).toThrow(OracleError);

      try {
        resolveMarketOracle(
          market,
          btoa("proof"),
          BITFLYER_HOST,
          body,
          now,
          wrongPreimage,
        );
      } catch (e) {
        expect((e as OracleError).message).toContain(
          "Preimage does not match",
        );
      }
    });

    test("rejects double resolution via dual preimage store", () => {
      const dualStore = createDualPreimageStore();
      const marketId = bytesToHex(randomBytes(16));
      dualStore.create(marketId);

      // First resolve succeeds
      const first = resolveMarketDual(marketId, "yes", dualStore);
      expect(first).not.toBeNull();

      // Second resolve (any outcome) must fail
      const secondYes = resolveMarketDual(marketId, "yes", dualStore);
      expect(secondYes).toBeNull();

      const secondNo = resolveMarketDual(marketId, "no", dualStore);
      expect(secondNo).toBeNull();
    });

    test("rejects resolution of unknown market in dual store", () => {
      const dualStore = createDualPreimageStore();
      const result = resolveMarketDual("nonexistent-market", "yes", dualStore);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // 6. Payout calculations -- detailed edge cases
  // =========================================================================

  describe("payout calculation", () => {
    test("no payouts when winning pool is empty", () => {
      const market = makeMarket({
        yes_pool_sats: 0,
        no_pool_sats: 500,
      });

      const bets = [
        { side: "no" as const, amount_sats: 500, bettor_pubkey: "bob" },
      ];

      // YES wins but nobody bet YES -> no payouts
      const payouts = calculatePayouts(market, "yes", bets, ORACLE_FEE_PPM);
      expect(payouts.length).toBe(0);
    });

    test("single winner gets entire payable pool", () => {
      const market = makeMarket({
        yes_pool_sats: 1000,
        no_pool_sats: 1000,
      });

      const bets = [
        { side: "yes" as const, amount_sats: 1000, bettor_pubkey: "alice" },
        { side: "no" as const, amount_sats: 1000, bettor_pubkey: "bob" },
      ];

      const payouts = calculatePayouts(market, "yes", bets, ORACLE_FEE_PPM);
      expect(payouts.length).toBe(1);
      expect(payouts[0]!.bettor_pubkey).toBe("alice");

      const totalPool = 2000;
      const oracleFee = calculateOracleFee(totalPool, ORACLE_FEE_PPM);
      const creatorFee = calculateOracleFee(totalPool, market.fee_ppm);
      const payablePool = totalPool - oracleFee - creatorFee;
      expect(payouts[0]!.payout_sats).toBe(payablePool);
    });

    test("multiple winners split proportionally", () => {
      const market = makeMarket({
        yes_pool_sats: 400,
        no_pool_sats: 600,
        fee_ppm: 0, // No creator fee for simpler math
      });

      const bets = [
        { side: "yes" as const, amount_sats: 100, bettor_pubkey: "a" },
        { side: "yes" as const, amount_sats: 300, bettor_pubkey: "b" },
        { side: "no" as const, amount_sats: 600, bettor_pubkey: "c" },
      ];

      const payouts = calculatePayouts(market, "yes", bets, 0);
      expect(payouts.length).toBe(2);

      // No fees -> payable pool = 1000
      const payoutA = payouts.find((p) => p.bettor_pubkey === "a");
      const payoutB = payouts.find((p) => p.bettor_pubkey === "b");
      expect(payoutA!.payout_sats).toBe(Math.floor((100 / 400) * 1000));
      expect(payoutB!.payout_sats).toBe(Math.floor((300 / 400) * 1000));
    });

    test("oracle fee calculation: ceil rounding", () => {
      // 100 sats * 5000 ppm = 0.5 sats -> ceil = 1
      expect(calculateOracleFee(100, 5_000)).toBe(1);
      // 200 sats * 5000 ppm = 1.0 sats -> ceil = 1
      expect(calculateOracleFee(200, 5_000)).toBe(1);
      // 1000 sats * 5000 ppm = 5.0 sats -> ceil = 5
      expect(calculateOracleFee(1000, 5_000)).toBe(5);
      // 0 sats -> 0
      expect(calculateOracleFee(0, 5_000)).toBe(0);
    });
  });

  // =========================================================================
  // 7. extractJsonValue edge cases
  // =========================================================================

  describe("extractJsonValue", () => {
    test("extracts nested value via dot notation", () => {
      const body = JSON.stringify({ data: { price: 42 } });
      expect(extractJsonValue(body, "data.price")).toBe(42);
    });

    test("extracts array element", () => {
      const body = JSON.stringify({ results: [{ v: 10 }, { v: 20 }] });
      expect(extractJsonValue(body, "results[1].v")).toBe(20);
    });

    test("returns full parsed object when no path given", () => {
      const body = JSON.stringify({ a: 1 });
      const result = extractJsonValue(body) as Record<string, unknown>;
      expect(result.a).toBe(1);
    });

    test("throws on invalid JSON", () => {
      expect(() => extractJsonValue("not json")).toThrow(OracleError);
    });

    test("throws on null in path", () => {
      const body = JSON.stringify({ a: null });
      expect(() => extractJsonValue(body, "a.b")).toThrow(OracleError);
    });
  });

  // =========================================================================
  // 8. verifyPreimage
  // =========================================================================

  describe("verifyPreimage", () => {
    test("valid preimage matches its hash", () => {
      const { preimage, hash } = makePreimage();
      expect(verifyPreimage(preimage, hash)).toBe(true);
    });

    test("wrong preimage does not match", () => {
      const { hash } = makePreimage();
      const wrong = bytesToHex(randomBytes(32));
      expect(verifyPreimage(wrong, hash)).toBe(false);
    });
  });
});
