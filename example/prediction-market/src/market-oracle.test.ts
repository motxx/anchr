import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  resolveMarket,
  verifyPreimage,
  OracleError,
} from "./market-oracle.ts";
import type { PredictionMarket } from "./market-types.ts";

function makePreimage(): { preimage: string; hash: string } {
  const raw = randomBytes(32);
  return { preimage: bytesToHex(raw), hash: bytesToHex(sha256(raw)) };
}

function makeMarket(overrides: Partial<PredictionMarket> = {}): PredictionMarket {
  const { preimage, hash } = makePreimage();
  return {
    id: bytesToHex(randomBytes(16)),
    title: "Test market",
    description: "Test",
    category: "crypto",
    creator_pubkey: bytesToHex(randomBytes(32)),
    resolution_url: "https://api.example.com/price",
    resolution_condition: {
      type: "jsonpath_gt",
      target_url: "https://api.example.com/price",
      jsonpath: "price",
      threshold: 100,
      description: "price > 100",
    },
    resolution_deadline: Math.floor(Date.now() / 1000) + 86400,
    yes_pool_sats: 100,
    no_pool_sats: 100,
    min_bet_sats: 1,
    max_bet_sats: 1_000_000,
    fee_ppm: 10_000,
    oracle_pubkey: bytesToHex(randomBytes(32)),
    htlc_hash_yes: hash,
    htlc_hash_no: bytesToHex(sha256(randomBytes(32))),
    nostr_event_id: bytesToHex(randomBytes(32)),
    status: "open",
    ...overrides,
  } as PredictionMarket;
}

test("resolveMarket works with htlc_hash_yes", () => {
  const { preimage, hash } = makePreimage();
  const market = makeMarket({ htlc_hash_yes: hash });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ price: 200 });

  const result = resolveMarket(
    market,
    btoa("proof"),
    "api.example.com",
    body,
    now,
    preimage,
  );

  expect(result.outcome).toBe("yes");
  expect(result.preimage).toBe(preimage);
});

test("resolveMarket falls back to htlc_hash for legacy markets", () => {
  const { preimage, hash } = makePreimage();
  // Simulate a legacy market with htlc_hash but no htlc_hash_yes
  const market = makeMarket({ htlc_hash_yes: undefined as unknown as string, htlc_hash: hash } as Partial<PredictionMarket>);
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ price: 200 });

  const result = resolveMarket(
    market,
    btoa("proof"),
    "api.example.com",
    body,
    now,
    preimage,
  );

  expect(result.outcome).toBe("yes");
});

test("resolveMarket throws on preimage/hash mismatch", () => {
  const market = makeMarket();
  const wrongPreimage = bytesToHex(randomBytes(32));
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ price: 200 });

  expect(() => {
    resolveMarket(market, btoa("proof"), "api.example.com", body, now, wrongPreimage);
  }).toThrow(OracleError);
});

test("resolveMarket returns NO when condition not met", () => {
  const { preimage, hash } = makePreimage();
  const market = makeMarket({ htlc_hash_yes: hash });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ price: 50 }); // Below threshold of 100

  const result = resolveMarket(
    market,
    btoa("proof"),
    "api.example.com",
    body,
    now,
    preimage,
  );

  expect(result.outcome).toBe("no");
  expect(result.preimage).toBeUndefined();
});
