/**
 * Exchange Protocol Tests — verifyReceivedToken + P2PK condition verification.
 *
 * Tests verify that:
 * 1. Valid tokens pass verification
 * 2. Invalid tokens (wrong pubkeys, wrong amount, wrong locktime) are rejected
 * 3. P2PK secret parsing handles NUT-11 format correctly
 */

import { test, describe } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { verifyReceivedToken } from "./exchange-protocol.ts";
import { getEncodedToken, type Proof } from "@cashu/cashu-ts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeypair() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { secretKey: sk, pubkey: pk };
}

/**
 * Create a mock Cashu proof with a NUT-11 P2PK secret.
 *
 * The secret format follows NUT-11:
 * ["P2PK", {"data": "<primary_pubkey>", "nonce": "<hex>", "tags": [...]}]
 */
function mockP2PKProof(opts: {
  amount: number;
  primaryPubkey: string;
  additionalPubkeys?: string[];
  nSigs?: number;
  locktime?: number;
  sigflag?: string;
}): Proof {
  const tags: Array<[string, ...string[]]> = [];

  if (opts.additionalPubkeys && opts.additionalPubkeys.length > 0) {
    tags.push(["pubkeys", ...opts.additionalPubkeys]);
  }
  if (opts.nSigs !== undefined) {
    tags.push(["n_sigs", String(opts.nSigs)]);
  }
  if (opts.locktime !== undefined) {
    tags.push(["locktime", String(opts.locktime)]);
  }
  if (opts.sigflag) {
    tags.push(["sigflag", opts.sigflag]);
  }

  const secret = JSON.stringify([
    "P2PK",
    {
      data: opts.primaryPubkey,
      nonce: bytesToHex(randomBytes(16)),
      tags,
    },
  ]);

  return {
    amount: opts.amount,
    id: "mock-keyset-id",
    secret,
    C: bytesToHex(randomBytes(32)),
  } as Proof;
}

function encodeProofs(proofs: Proof[]): string {
  return getEncodedToken({ mint: "https://mock-mint.example.com", proofs });
}

// ---------------------------------------------------------------------------
// Tests: verifyReceivedToken
// ---------------------------------------------------------------------------

describe("verifyReceivedToken", () => {
  const groupPubkey = makeKeypair().pubkey;
  const myPubkey = makeKeypair().pubkey;
  const locktime = Math.floor(Date.now() / 1000) + 86400;

  test("accepts a valid P2PK-locked token", () => {
    const proof = mockP2PKProof({
      amount: 64,
      primaryPubkey: groupPubkey,
      additionalPubkeys: [myPubkey],
      nSigs: 2,
      locktime,
      sigflag: "SIG_ALL",
    });

    const token = encodeProofs([proof]);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("accepts token with multiple proofs summing to correct amount", () => {
    const proofs = [
      mockP2PKProof({
        amount: 32,
        primaryPubkey: groupPubkey,
        additionalPubkeys: [myPubkey],
        nSigs: 2,
        locktime,
      }),
      mockP2PKProof({
        amount: 32,
        primaryPubkey: groupPubkey,
        additionalPubkeys: [myPubkey],
        nSigs: 2,
        locktime,
      }),
    ];

    const token = encodeProofs(proofs);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    expect(result.valid).toBe(true);
  });

  test("rejects token with insufficient amount", () => {
    const proof = mockP2PKProof({
      amount: 32,
      primaryPubkey: groupPubkey,
      additionalPubkeys: [myPubkey],
      nSigs: 2,
      locktime,
    });

    const token = encodeProofs([proof]);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Insufficient amount");
  });

  test("rejects token missing group pubkey", () => {
    const wrongPubkey = makeKeypair().pubkey;
    const proof = mockP2PKProof({
      amount: 64,
      primaryPubkey: wrongPubkey,
      additionalPubkeys: [myPubkey],
      nSigs: 2,
      locktime,
    });

    const token = encodeProofs([proof]);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing group pubkey");
  });

  test("rejects token missing my pubkey", () => {
    const proof = mockP2PKProof({
      amount: 64,
      primaryPubkey: groupPubkey,
      additionalPubkeys: [], // missing myPubkey
      nSigs: 2,
      locktime,
    });

    const token = encodeProofs([proof]);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing my pubkey");
  });

  test("rejects token with wrong n_sigs (1 instead of 2)", () => {
    const proof = mockP2PKProof({
      amount: 64,
      primaryPubkey: groupPubkey,
      additionalPubkeys: [myPubkey],
      nSigs: 1,
      locktime,
    });

    const token = encodeProofs([proof]);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("n_sigs=1");
  });

  test("rejects token with too-short locktime", () => {
    const shortLocktime = Math.floor(Date.now() / 1000) + 300; // 5 min
    const proof = mockP2PKProof({
      amount: 64,
      primaryPubkey: groupPubkey,
      additionalPubkeys: [myPubkey],
      nSigs: 2,
      locktime: shortLocktime,
    });

    const token = encodeProofs([proof]);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime, // requires longer locktime
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Locktime too short");
  });

  test("rejects invalid cashu token string", () => {
    const result = verifyReceivedToken("not-a-token", {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("decode");
  });

  test("rejects non-P2PK secret", () => {
    const proof = {
      amount: 64,
      id: "mock-keyset",
      secret: bytesToHex(randomBytes(32)), // plain secret, not P2PK
      C: bytesToHex(randomBytes(32)),
    } as Proof;

    const token = encodeProofs([proof]);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("P2PK");
  });

  test("accepts token when no locktime specified in proof (no locktime tag)", () => {
    // If proof has no locktime tag, the locktime is undefined.
    // This should still pass because we only reject if locktime < minLocktime,
    // and undefined locktime means no locktime restriction at all.
    const proof = mockP2PKProof({
      amount: 64,
      primaryPubkey: groupPubkey,
      additionalPubkeys: [myPubkey],
      nSigs: 2,
      // No locktime set
    });

    const token = encodeProofs([proof]);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    // No locktime tag means undefined, which passes the check
    expect(result.valid).toBe(true);
  });

  test("accepts token with excess amount", () => {
    const proof = mockP2PKProof({
      amount: 128,
      primaryPubkey: groupPubkey,
      additionalPubkeys: [myPubkey],
      nSigs: 2,
      locktime,
    });

    const token = encodeProofs([proof]);
    const result = verifyReceivedToken(token, {
      groupPubkey,
      myPubkey,
      amount: 64,
      minLocktime: locktime,
    });

    expect(result.valid).toBe(true);
  });
});
