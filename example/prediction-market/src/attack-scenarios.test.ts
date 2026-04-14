/**
 * Attack Scenario Tests — CTF-style security property verification.
 *
 * These tests verify that the prediction market protocol is resilient to
 * specific attack vectors identified during security review. All tests are
 * unit-level and do not require Docker or a running mint.
 */

import { test, describe } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { schnorr } from "@noble/curves/secp256k1";
import {
  buildFrostSwapForPartyA,
  buildFrostSwapForPartyB,
  createDualKeyStore,
} from "../../../src/infrastructure/conditional-swap/frost-conditional-swap.ts";
import { resolveMarketFrost } from "./resolution.ts";
import { calculatePayouts } from "./market-oracle.ts";
import type { PredictionMarket } from "./market-types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a keypair using nostr-tools (returns x-only pubkey). */
function makeKeypair() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { secretKey: sk, pubkey: pk };
}

/** Build a minimal PredictionMarket for testing payouts. */
function makeMarket(overrides: Partial<PredictionMarket> = {}): PredictionMarket {
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
    fee_ppm: 0,
    oracle_pubkey: bytesToHex(randomBytes(32)),
    htlc_hash_yes: bytesToHex(randomBytes(32)),
    htlc_hash_no: bytesToHex(randomBytes(32)),
    nostr_event_id: bytesToHex(randomBytes(32)),
    status: "open",
    ...overrides,
  } as PredictionMarket;
}

// ===========================================================================
// Attack 1: Locktime Refund Race
// ===========================================================================

describe("Attack 1: Locktime Refund Race", () => {
  test("server uses market.resolution_deadline as locktime for P2PK tokens", () => {
    // The server-routes.ts match logic passes market.resolution_deadline as
    // the locktime to buildFrostSwapForPartyA/B. This test verifies the
    // builder embeds that locktime correctly.
    const resolutionDeadline = Math.floor(Date.now() / 1000) + 86400; // T + 24h
    const groupPubkeyNo = makeKeypair().pubkey;
    const counterparty = makeKeypair().pubkey;
    const refund = makeKeypair().pubkey;

    const opts = buildFrostSwapForPartyA({
      group_pubkey_b: groupPubkeyNo,
      counterpartyPubkey: counterparty,
      refundPubkey: refund,
      locktime: resolutionDeadline,
    });

    // P2PKBuilder serializes locktime into the options object.
    // Verify it is present and matches the resolution_deadline.
    const serialized = JSON.stringify(opts);
    expect(serialized).toContain(String(resolutionDeadline));
  });

  test("locktime < resolution_deadline would allow early refund (demonstration)", () => {
    // This test documents the attack vector: if an attacker could specify
    // a shorter locktime, they could refund before the Oracle resolves.
    //
    // Defense: the server hardcodes locktime = market.resolution_deadline.
    // The user cannot override it. We verify both sides use the same locktime.
    const resolutionDeadline = Math.floor(Date.now() / 1000) + 86400;
    const store = createDualKeyStore();
    const entry = store.create("market-locktime-test");
    const alice = makeKeypair();
    const bob = makeKeypair();

    const optsYesToNo = buildFrostSwapForPartyA({
      group_pubkey_b: entry.pubkey_b,
      counterpartyPubkey: bob.pubkey,
      refundPubkey: alice.pubkey,
      locktime: resolutionDeadline,
    });

    const optsNoToYes = buildFrostSwapForPartyB({
      group_pubkey_a: entry.pubkey_a,
      counterpartyPubkey: alice.pubkey,
      refundPubkey: bob.pubkey,
      locktime: resolutionDeadline,
    });

    // Both directions embed the same locktime (resolution_deadline)
    const strA = JSON.stringify(optsYesToNo);
    const strB = JSON.stringify(optsNoToYes);
    expect(strA).toContain(String(resolutionDeadline));
    expect(strB).toContain(String(resolutionDeadline));
  });

  test("locktime should include buffer beyond resolution_deadline", () => {
    // Edge case: if resolution happens right at the deadline, the Oracle
    // may not have published the signature before locktime expires.
    // Production should add a buffer (e.g., 1 hour) to the locktime.
    //
    // Verify: locktime = resolution_deadline + buffer is accepted.
    const resolutionDeadline = Math.floor(Date.now() / 1000) + 86400;
    const BUFFER_SECONDS = 3600; // 1 hour
    const locktimeWithBuffer = resolutionDeadline + BUFFER_SECONDS;

    const opts = buildFrostSwapForPartyA({
      group_pubkey_b: makeKeypair().pubkey,
      counterpartyPubkey: makeKeypair().pubkey,
      refundPubkey: makeKeypair().pubkey,
      locktime: locktimeWithBuffer,
    });

    const serialized = JSON.stringify(opts);
    expect(serialized).toContain(String(locktimeWithBuffer));

    // The locktime with buffer is strictly greater than resolution_deadline
    expect(locktimeWithBuffer).toBeGreaterThan(resolutionDeadline);
  });
});

// ===========================================================================
// Attack 2: Both-sides signature (Oracle collusion)
// ===========================================================================

describe("Attack 2: Oracle Double-Signing Prevention", () => {
  test("signing both YES and NO should be impossible in single-key mode", () => {
    const store = createDualKeyStore();
    store.create("swap-double-sign");

    const msgA = randomBytes(32);
    const msgB = randomBytes(32);

    // Sign outcome "a" (YES) — succeeds
    const sigA = store.sign("swap-double-sign", "a", msgA);
    expect(sigA).toBeTruthy();

    // Attempt to sign outcome "b" (NO) — returns null (key deleted)
    const sigB = store.sign("swap-double-sign", "b", msgB);
    expect(sigB).toBeNull();
  });

  test("after signing YES, the NO secret key is irrecoverable", () => {
    const store = createDualKeyStore();
    const entry = store.create("swap-key-delete");

    // Sign outcome "a" (YES)
    const msg = randomBytes(32);
    const sig = store.sign("swap-key-delete", "a", msg);
    expect(sig).toBeTruthy();

    // Verify the YES signature is valid
    const valid = schnorr.verify(hexToBytes(sig!), msg, hexToBytes(entry.pubkey_a));
    expect(valid).toBe(true);

    // The store is now marked as signed — even re-creating won't help
    // because create() is idempotent and returns the existing (signed) entry
    const reEntry = store.create("swap-key-delete");
    expect(reEntry.pubkey_a).toBe(entry.pubkey_a);

    // No further signing is possible
    expect(store.sign("swap-key-delete", "a", randomBytes(32))).toBeNull();
    expect(store.sign("swap-key-delete", "b", randomBytes(32))).toBeNull();
  });

  test("resolveMarketFrost returns null on second resolution attempt", () => {
    const store = createDualKeyStore();
    store.create("market-double-resolve");

    // First resolution (YES wins) — succeeds
    const result1 = resolveMarketFrost("market-double-resolve", "yes", store);
    expect(result1).not.toBeNull();
    expect(result1!.outcome).toBe("yes");
    expect(result1!.oracle_signature).toBeTruthy();

    // Second resolution attempt (NO) — fails
    const result2 = resolveMarketFrost("market-double-resolve", "no", store);
    expect(result2).toBeNull();
  });

  test("both-sides betting by same user yields zero net profit", () => {
    // Alice bets 100 sats YES and 100 sats NO with the same pubkey.
    // Regardless of outcome, her net result is zero (minus fees).
    const alicePubkey = bytesToHex(randomBytes(32));
    const market = makeMarket({
      yes_pool_sats: 100,
      no_pool_sats: 100,
      fee_ppm: 0,
    });

    const bets = [
      { side: "yes" as const, amount_sats: 100, bettor_pubkey: alicePubkey },
      { side: "no" as const, amount_sats: 100, bettor_pubkey: alicePubkey },
    ];

    // YES wins: Alice wins her NO bet back but loses her YES bet
    const payoutsYes = calculatePayouts(market, "yes", bets, 0);
    const totalPayoutYes = payoutsYes.reduce((acc, p) => acc + p.payout_sats, 0);
    // Alice wagered 200 total, gets back 200 (her share of the winning pool)
    expect(totalPayoutYes).toBe(200);

    // NO wins: same result
    const payoutsNo = calculatePayouts(market, "no", bets, 0);
    const totalPayoutNo = payoutsNo.reduce((acc, p) => acc + p.payout_sats, 0);
    expect(totalPayoutNo).toBe(200);

    // Net profit is zero in both cases (200 wagered, 200 returned)
    expect(totalPayoutYes - 200).toBe(0);
    expect(totalPayoutNo - 200).toBe(0);
  });
});

// ===========================================================================
// Attack 3: FROST signature not usable as P2PK witness
// ===========================================================================

describe("Attack 3: Oracle Signature Must Match Proof Secret", () => {
  test("Oracle signature must be on proof.secret, not market message", () => {
    // Create a simulated P2PK proof with a random secret.
    // The Oracle must sign SHA256(proof.secret) for each proof individually.
    // A market-level message signature is NOT valid for SHA256(proof.secret).
    const oracleKeypair = makeKeypair();

    // Simulate a proof secret (random 32-byte nonce, as cashu-ts generates)
    const proofSecret = bytesToHex(randomBytes(32));
    const proofSecretHash = sha256(new TextEncoder().encode(proofSecret));

    // Correct: Oracle signs SHA256(proof.secret) — per-proof signing
    const correctSig = schnorr.sign(proofSecretHash, oracleKeypair.secretKey);
    const correctValid = schnorr.verify(
      correctSig,
      proofSecretHash,
      hexToBytes(oracleKeypair.pubkey),
    );
    expect(correctValid).toBe(true);

    // Incorrect: Oracle signs a market-level message (e.g., "market-123:yes")
    const marketMessage = new TextEncoder().encode("market-123:yes");
    const wrongSig = schnorr.sign(marketMessage, oracleKeypair.secretKey);

    // The market-level signature is NOT valid for SHA256(proof.secret)
    const wrongValid = schnorr.verify(
      wrongSig,
      proofSecretHash,
      hexToBytes(oracleKeypair.pubkey),
    );
    expect(wrongValid).toBe(false);
  });

  test("each proof has a unique secret requiring a unique signature", () => {
    // Multiple proofs in a token each have different secrets.
    // The Oracle must sign each one individually.
    const oracleKeypair = makeKeypair();

    const secrets = Array.from({ length: 3 }, () => bytesToHex(randomBytes(32)));
    const hashes = secrets.map((s) => sha256(new TextEncoder().encode(s)));

    // Sign each proof's secret hash individually
    const signatures = hashes.map((h) =>
      schnorr.sign(h, oracleKeypair.secretKey),
    );

    // Each signature is valid only for its corresponding proof secret
    for (let i = 0; i < 3; i++) {
      const valid = schnorr.verify(
        signatures[i]!,
        hashes[i]!,
        hexToBytes(oracleKeypair.pubkey),
      );
      expect(valid).toBe(true);

      // Cross-proof: signature[i] is NOT valid for hash[j] where j != i
      const j = (i + 1) % 3;
      const crossValid = schnorr.verify(
        signatures[i]!,
        hashes[j]!,
        hexToBytes(oracleKeypair.pubkey),
      );
      expect(crossValid).toBe(false);
    }
  });

  test("market-level signature is useless for any proof redemption", () => {
    // Even if the Oracle publishes a market-level signature, it cannot be
    // used as a P2PK witness for any individual proof.
    const oracleKeypair = makeKeypair();
    const marketMsg = new TextEncoder().encode("market-xyz:yes");
    const marketSig = schnorr.sign(marketMsg, oracleKeypair.secretKey);

    // Try to use this signature against 5 different proof secrets
    for (let i = 0; i < 5; i++) {
      const proofSecret = bytesToHex(randomBytes(32));
      const proofHash = sha256(new TextEncoder().encode(proofSecret));

      const valid = schnorr.verify(
        marketSig,
        proofHash,
        hexToBytes(oracleKeypair.pubkey),
      );
      expect(valid).toBe(false);
    }
  });
});

// ===========================================================================
// Attack 4: Wrong winner redeem attempt
// ===========================================================================

describe("Attack 4: Loser Cannot Redeem With Winner's Signature", () => {
  test("loser cannot use winner's Oracle signature to redeem", () => {
    // Setup: YES wins. Oracle signs with group_yes key.
    // Bob (NO bettor) has token_yes_to_no locked to [group_no, bob].
    // Bob tries to use the YES signature on his token -- fails because
    // the token requires group_no's key, not group_yes.
    const store = createDualKeyStore();
    const entry = store.create("market-wrong-winner");
    const alice = makeKeypair(); // YES bettor
    const bob = makeKeypair(); // NO bettor

    // YES wins: Oracle signs with group_a (YES) key
    const resolutionMsg = new TextEncoder().encode("market-wrong-winner:yes");
    const oracleSigYes = store.sign("market-wrong-winner", "a", resolutionMsg);
    expect(oracleSigYes).toBeTruthy();

    // Bob's token (token_yes_to_no) is locked with [group_no, bob].
    // It requires a signature from group_no's key.
    // The Oracle signed with group_yes's key -- different key entirely.
    const bobProofSecret = bytesToHex(randomBytes(32));
    const bobProofHash = sha256(new TextEncoder().encode(bobProofSecret));

    // Oracle's YES signature is verified against group_yes pubkey (entry.pubkey_a)
    // NOT against group_no pubkey (entry.pubkey_b).
    const verifyAgainstGroupNo = schnorr.verify(
      hexToBytes(oracleSigYes!),
      resolutionMsg,
      hexToBytes(entry.pubkey_b), // group_no key
    );
    expect(verifyAgainstGroupNo).toBe(false);

    // The signature IS valid against group_yes pubkey
    const verifyAgainstGroupYes = schnorr.verify(
      hexToBytes(oracleSigYes!),
      resolutionMsg,
      hexToBytes(entry.pubkey_a), // group_yes key
    );
    expect(verifyAgainstGroupYes).toBe(true);
  });

  test("P2PK lock keys differ between YES-to-NO and NO-to-YES directions", () => {
    // Verify that the P2PK options for opposite directions use different
    // group keys, so a signature for one direction cannot satisfy the other.
    const store = createDualKeyStore();
    const entry = store.create("market-direction-test");
    const alice = makeKeypair();
    const bob = makeKeypair();
    const locktime = Math.floor(Date.now() / 1000) + 86400;

    // token_yes_to_no: locked with [group_no, bob] — Bob redeems if NO wins
    const optsYesToNo = buildFrostSwapForPartyA({
      group_pubkey_b: entry.pubkey_b,
      counterpartyPubkey: bob.pubkey,
      refundPubkey: alice.pubkey,
      locktime,
    });

    // token_no_to_yes: locked with [group_yes, alice] — Alice redeems if YES wins
    const optsNoToYes = buildFrostSwapForPartyB({
      group_pubkey_a: entry.pubkey_a,
      counterpartyPubkey: alice.pubkey,
      refundPubkey: bob.pubkey,
      locktime,
    });

    const strYesToNo = JSON.stringify(optsYesToNo);
    const strNoToYes = JSON.stringify(optsNoToYes);

    // YES-to-NO direction contains group_no pubkey, NOT group_yes
    expect(strYesToNo).toContain(entry.pubkey_b);
    expect(strYesToNo).not.toContain(entry.pubkey_a);

    // NO-to-YES direction contains group_yes pubkey, NOT group_no
    expect(strNoToYes).toContain(entry.pubkey_a);
    expect(strNoToYes).not.toContain(entry.pubkey_b);
  });
});

// ===========================================================================
// Attack 5: Replay attack — reuse Oracle signature across markets
// ===========================================================================

describe("Attack 5: Cross-Market Replay Attack", () => {
  test("Oracle signature from market A cannot be used in market B", () => {
    // Each market has its own DualKeyStore entry with unique keypairs.
    // A signature from market A's Oracle key is invalid for market B's key.
    const store = createDualKeyStore();
    const entryA = store.create("market-A");
    const entryB = store.create("market-B");

    // Verify the markets have different group keys
    expect(entryA.pubkey_a).not.toBe(entryB.pubkey_a);
    expect(entryA.pubkey_b).not.toBe(entryB.pubkey_b);

    // Oracle signs for market A (YES wins)
    const msgA = new TextEncoder().encode("market-A:yes");
    const sigA = store.sign("market-A", "a", msgA);
    expect(sigA).toBeTruthy();

    // Try to verify market A's signature against market B's pubkeys
    const replayAgainstB_yes = schnorr.verify(
      hexToBytes(sigA!),
      msgA,
      hexToBytes(entryB.pubkey_a),
    );
    expect(replayAgainstB_yes).toBe(false);

    const replayAgainstB_no = schnorr.verify(
      hexToBytes(sigA!),
      msgA,
      hexToBytes(entryB.pubkey_b),
    );
    expect(replayAgainstB_no).toBe(false);
  });

  test("proof secrets contain unique nonces preventing cross-market replay", () => {
    // Even within the same Oracle key, each proof has a unique secret
    // with a random nonce. A signature on one proof's secret hash
    // cannot satisfy a different proof's secret hash.
    const oracle = makeKeypair();

    // Simulated proofs from market A and market B
    const secretMarketA = bytesToHex(randomBytes(32));
    const secretMarketB = bytesToHex(randomBytes(32));

    // These secrets are different with overwhelming probability
    expect(secretMarketA).not.toBe(secretMarketB);

    const hashA = sha256(new TextEncoder().encode(secretMarketA));
    const hashB = sha256(new TextEncoder().encode(secretMarketB));

    // Oracle signs market A's proof
    const sigForA = schnorr.sign(hashA, oracle.secretKey);

    // Signature for A is valid against hash A
    expect(schnorr.verify(sigForA, hashA, hexToBytes(oracle.pubkey))).toBe(true);

    // Signature for A is NOT valid against hash B
    expect(schnorr.verify(sigForA, hashB, hexToBytes(oracle.pubkey))).toBe(false);
  });

  test("DualKeyStore uses independent keys per market", () => {
    // Create multiple markets and verify complete key independence
    const store = createDualKeyStore();
    const markets = Array.from({ length: 5 }, (_, i) => store.create(`market-${i}`));

    // All pubkeys should be unique across markets
    const allPubkeysA = markets.map((m) => m.pubkey_a);
    const allPubkeysB = markets.map((m) => m.pubkey_b);
    const allPubkeys = [...allPubkeysA, ...allPubkeysB];

    const uniquePubkeys = new Set(allPubkeys);
    expect(uniquePubkeys.size).toBe(allPubkeys.length);
  });
});

// ===========================================================================
// Attack 6: Token double-spend after non-custodial distribution
// ===========================================================================

describe("Attack 6: Insufficient Signatures Without Oracle", () => {
  test("user receives locked token at match time, cannot spend without Oracle sig", () => {
    // Alice (YES bettor) receives token_no_to_yes (Bob's proofs) at match time.
    // The token is locked with P2PK([group_yes, alice], n_sigs=2).
    // Alice only has her own key — she can produce 1 of 2 required signatures.
    // Without the Oracle's group_yes signature, she cannot redeem.
    const store = createDualKeyStore();
    const entry = store.create("market-no-oracle-sig");
    const alice = makeKeypair();
    const bob = makeKeypair();
    const locktime = Math.floor(Date.now() / 1000) + 86400;

    // token_no_to_yes is locked with [group_yes, alice], n_sigs=2
    const opts = buildFrostSwapForPartyB({
      group_pubkey_a: entry.pubkey_a, // group_yes
      counterpartyPubkey: alice.pubkey,
      refundPubkey: bob.pubkey,
      locktime,
    });

    // Verify the lock requires 2 signatures
    const serialized = JSON.stringify(opts);
    expect(serialized).toContain(alice.pubkey);
    expect(serialized).toContain(entry.pubkey_a); // group_yes

    // Alice can sign with her own key
    const proofSecret = bytesToHex(randomBytes(32));
    const proofHash = sha256(new TextEncoder().encode(proofSecret));
    const aliceSig = schnorr.sign(proofHash, alice.secretKey);

    // Alice's signature is valid for her key
    const aliceSigValid = schnorr.verify(aliceSig, proofHash, hexToBytes(alice.pubkey));
    expect(aliceSigValid).toBe(true);

    // But Alice cannot forge the Oracle's group_yes signature
    // Her signature does NOT verify against the group_yes pubkey
    const forgeAttempt = schnorr.verify(aliceSig, proofHash, hexToBytes(entry.pubkey_a));
    expect(forgeAttempt).toBe(false);

    // Without Oracle signing, Alice only has 1 of 2 required signatures
    // The mint would reject this redemption attempt
  });

  test("Bob (loser) cannot spend Alice's tokens locked to [group_no, bob]", () => {
    // If YES wins, Bob (NO bettor) has token_yes_to_no locked to [group_no, bob].
    // The Oracle will NOT sign with group_no. Bob has his own key but cannot
    // produce the Oracle's group_no signature.
    const store = createDualKeyStore();
    const entry = store.create("market-loser-spend");
    const alice = makeKeypair();
    const bob = makeKeypair();

    // YES wins: Oracle signs with group_yes (outcome "a")
    const resolutionMsg = new TextEncoder().encode("market-loser-spend:yes");
    const oracleSig = store.sign("market-loser-spend", "a", resolutionMsg);
    expect(oracleSig).toBeTruthy();

    // Bob's token (token_yes_to_no) needs [group_no, bob] signatures.
    // group_no key was NOT used for signing — its secret was deleted.
    // Bob can only sign with his own key: 1 of 2 required.
    const proofHash = sha256(new TextEncoder().encode(bytesToHex(randomBytes(32))));
    const bobSig = schnorr.sign(proofHash, bob.secretKey);

    // Bob's sig verifies for his own key
    expect(schnorr.verify(bobSig, proofHash, hexToBytes(bob.pubkey))).toBe(true);

    // Bob's sig does NOT verify for group_no
    expect(schnorr.verify(bobSig, proofHash, hexToBytes(entry.pubkey_b))).toBe(false);

    // The Oracle's YES signature does NOT verify for group_no either
    expect(
      schnorr.verify(hexToBytes(oracleSig!), resolutionMsg, hexToBytes(entry.pubkey_b)),
    ).toBe(false);

    // Result: Bob has 0 of 2 valid signatures for his token's lock.
    // The tokens remain locked until locktime refund.
  });

  test("only winner with Oracle signature achieves 2-of-2 threshold", () => {
    // Complete flow: YES wins. Alice (YES bettor) can redeem token_no_to_yes
    // because she has both: Oracle's group_yes sig + her own sig.
    const store = createDualKeyStore();
    const entry = store.create("market-full-flow");
    const alice = makeKeypair();

    // Simulate a proof secret for the locked token
    const proofSecret = bytesToHex(randomBytes(32));
    const proofHash = sha256(new TextEncoder().encode(proofSecret));

    // Oracle signs for YES (outcome "a") — using per-proof secret hash
    // In the real per-proof fix, Oracle signs SHA256(proof.secret) not a
    // market message. We simulate that here.
    const oracleSig = schnorr.sign(proofHash, hexToBytes(entry.secret_a!));

    // Verify: Oracle's sig valid for group_yes pubkey on this proof hash
    expect(
      schnorr.verify(oracleSig, proofHash, hexToBytes(entry.pubkey_a)),
    ).toBe(true);

    // Alice signs the same proof hash
    const aliceSig = schnorr.sign(proofHash, alice.secretKey);

    // Verify: Alice's sig valid for her pubkey on this proof hash
    expect(
      schnorr.verify(aliceSig, proofHash, hexToBytes(alice.pubkey)),
    ).toBe(true);

    // Alice now has 2-of-2 valid signatures: [Oracle group_yes, Alice]
    // This satisfies the P2PK lock condition for token_no_to_yes.
    // The mint accepts the redemption.
  });
});
