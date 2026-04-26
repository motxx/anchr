import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildEscrowP2PKOptions, calculateOracleFee, inspectEscrowToken } from "./escrow";

// Valid 32-byte x-only pubkeys (64 hex chars)
const ORACLE_PUB = "0000000000000000000000000000000000000000000000000000000000000001";
const WORKER_PUB = "0000000000000000000000000000000000000000000000000000000000000002";
const REQUESTER_PUB = "0000000000000000000000000000000000000000000000000000000000000003";

test("buildEscrowP2PKOptions creates 2-of-2 with timelock refund", () => {
  const opts = buildEscrowP2PKOptions({
    oraclePubkey: ORACLE_PUB,
    workerPubkey: WORKER_PUB,
    requesterRefundPubkey: REQUESTER_PUB,
    locktimeSeconds: 1700000000,
  });

  expect(opts.requiredSignatures).toBe(2);
  // P2PKBuilder prepends 02 prefix (compressed pubkey format)
  expect(opts.pubkey).toEqual([`02${ORACLE_PUB}`, `02${WORKER_PUB}`]);
  expect(opts.refundKeys).toEqual([`02${REQUESTER_PUB}`]);
  expect(opts.locktime).toBe(1700000000);
  expect(opts.sigFlag).toBe("SIG_ALL");
});

test("calculateOracleFee computes correct fee", () => {
  // 5% fee (50,000 ppm)
  expect(calculateOracleFee(100, 50_000)).toBe(5);
  expect(calculateOracleFee(1000, 50_000)).toBe(50);

  // 1% fee (10,000 ppm)
  expect(calculateOracleFee(100, 10_000)).toBe(1);
  expect(calculateOracleFee(1000, 10_000)).toBe(10);

  // Sub-sat rounds up
  expect(calculateOracleFee(1, 50_000)).toBe(1);

  // 0% fee
  expect(calculateOracleFee(100, 0)).toBe(0);
});

test("inspectEscrowToken returns null for invalid token", () => {
  expect(inspectEscrowToken("invalid")).toBe(null);
  expect(inspectEscrowToken("")).toBe(null);
});
