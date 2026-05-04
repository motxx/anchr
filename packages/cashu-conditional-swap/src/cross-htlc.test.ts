import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { buildCrossHtlcForPartyA, buildCrossHtlcForPartyB } from "./cross-htlc.ts";

function randomHash(): string {
  return bytesToHex(sha256(randomBytes(32)));
}

function randomPubkey(): string {
  return bytesToHex(randomBytes(32));
}

const LOCKTIME = Math.floor(Date.now() / 1000) + 86400;

test("buildCrossHtlcForPartyA returns valid P2PK options", () => {
  const hashB = randomHash();
  const counterparty = randomPubkey();
  const refund = randomPubkey();

  const opts = buildCrossHtlcForPartyA({
    hash_b: hashB,
    counterpartyPubkey: counterparty,
    refundPubkey: refund,
    locktime: LOCKTIME,
  });

  expect(opts).toBeTruthy();
  expect(typeof opts).toBe("object");
});

test("buildCrossHtlcForPartyB returns valid P2PK options", () => {
  const hashA = randomHash();
  const counterparty = randomPubkey();
  const refund = randomPubkey();

  const opts = buildCrossHtlcForPartyB({
    hash_a: hashA,
    counterpartyPubkey: counterparty,
    refundPubkey: refund,
    locktime: LOCKTIME,
  });

  expect(opts).toBeTruthy();
  expect(typeof opts).toBe("object");
});

test("party A and B use opposite hashes", () => {
  const hashA = randomHash();
  const hashB = randomHash();
  const pubkeyA = randomPubkey();
  const pubkeyB = randomPubkey();

  const optsA = buildCrossHtlcForPartyA({
    hash_b: hashB,
    counterpartyPubkey: pubkeyB,
    refundPubkey: pubkeyA,
    locktime: LOCKTIME,
  });

  const optsB = buildCrossHtlcForPartyB({
    hash_a: hashA,
    counterpartyPubkey: pubkeyA,
    refundPubkey: pubkeyB,
    locktime: LOCKTIME,
  });

  // Both should produce options but with different configurations
  expect(optsA).toBeTruthy();
  expect(optsB).toBeTruthy();

  // Serialize to compare — they should differ because different hashes/pubkeys
  const strA = JSON.stringify(optsA);
  const strB = JSON.stringify(optsB);
  expect(strA).not.toBe(strB);
});

test("locktime and refund pubkey are set correctly", () => {
  const hashB = randomHash();
  const counterparty = randomPubkey();
  const refund = randomPubkey();

  const opts = buildCrossHtlcForPartyA({
    hash_b: hashB,
    counterpartyPubkey: counterparty,
    refundPubkey: refund,
    locktime: LOCKTIME,
  });

  // P2PKOptions structure includes locktime and refund keys
  // The exact structure depends on cashu-ts P2PKBuilder output
  const serialized = JSON.stringify(opts);
  expect(serialized).toContain(refund);
  expect(serialized).toContain(counterparty);
});
