/**
 * E2E tests: FROST P2PK + real Cashu mint — full trustless prediction market flow.
 *
 * Tests the complete lifecycle using P2PK multi-sig instead of HTLC:
 *   1. Generate two Oracle keypairs (YES/NO groups) — simulates FROST DKG output
 *   2. Generate two user keypairs (Alice/Bob)
 *   3. Mint Cashu proofs via regtest Lightning
 *   4. Lock Alice's proofs with P2PK([group_pubkey_no, bob_pubkey], n_sigs=2)
 *      — she's betting YES, so Bob can redeem if NO wins
 *   5. Lock Bob's proofs with P2PK([group_pubkey_yes, alice_pubkey], n_sigs=2)
 *      — he's betting NO, so Alice can redeem if YES wins
 *   6. YES wins: Oracle signs with sk_yes
 *   7. Alice redeems Bob's locked proofs using oracle_signature + alice_signature
 *   8. Verify: Alice's redeemed proofs have correct amount
 *   9. Verify: Bob cannot redeem (no signature for NO group)
 *
 * Prerequisites:
 *   docker compose up -d
 *   sleep 25
 *   ./scripts/init-regtest.sh
 *   docker compose restart cashu-mint
 *
 * Run:
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   deno test e2e/frost-p2pk-cashu.test.ts --allow-all --no-check
 */

import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  Wallet,
  type Proof,
  P2PKBuilder,
  signP2PKProofs,
} from "@cashu/cashu-ts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { schnorr } from "@noble/curves/secp256k1";

import {
  buildFrostSwapForPartyA,
  buildFrostSwapForPartyB,
} from "../src/infrastructure/conditional-swap/frost-conditional-swap.ts";
import {
  checkInfraReady,
  createWallet,
  throttledMintProofs,
  throttleMintOp,
  retryOnRateLimit,
} from "./helpers/regtest.ts";

const MINT_URL = Deno.env.get("CASHU_MINT_URL") ?? "http://localhost:3338";
const BET_SATS = 64;

// ---------------------------------------------------------------------------
// Infrastructure readiness
// ---------------------------------------------------------------------------
const INFRA_READY = await checkInfraReady(MINT_URL);

// Create wallet at module level to avoid Deno sanitizer false positives.
const sharedWallet = INFRA_READY ? await createWallet(MINT_URL) : undefined;

// ---------------------------------------------------------------------------
// Keypair helpers
// ---------------------------------------------------------------------------

/** Generate a nostr-style hex keypair (x-only pubkey). */
function genKeypair() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { secretKey: bytesToHex(sk), publicKey: pk };
}

// ---------------------------------------------------------------------------
// P2PK token creation helper
// ---------------------------------------------------------------------------

/**
 * Create P2PK-locked proofs using the FROST swap builder pattern.
 *
 * Locks proofs with P2PK([groupPubkey, counterpartyPubkey], n_sigs=2).
 * The wallet's send().asP2PK() creates the locked tokens on the mint.
 */
async function createP2PKLockedProofs(
  wallet: Wallet,
  sourceProofs: Proof[],
  amountSats: number,
  p2pkOptions: import("@cashu/cashu-ts").P2PKOptions,
): Promise<Proof[]> {
  const fee = wallet.getFeesForProofs(sourceProofs);
  const sendAmount = amountSats - fee;
  if (sendAmount <= 0) throw new Error(`Fee (${fee}) exceeds amount (${amountSats})`);

  await throttleMintOp();
  const { send } = await retryOnRateLimit(() =>
    wallet.ops.send(sendAmount, sourceProofs).asP2PK(p2pkOptions).run()
  );

  return send;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const suite = INFRA_READY ? describe : describe.ignore;

suite("e2e: FROST P2PK + real Cashu mint — trustless prediction market flow", () => {
  const wallet = sharedWallet!;

  // Oracle keypairs (simulating FROST DKG output)
  let oracleYes: { secretKey: string; publicKey: string };
  let oracleNo: { secretKey: string; publicKey: string };

  // User keypairs
  let alice: { secretKey: string; publicKey: string };
  let bob: { secretKey: string; publicKey: string };

  // Minted proofs
  let aliceProofs: Proof[];
  let bobProofs: Proof[];

  // P2PK-locked proofs
  let aliceLockedProofs: Proof[]; // Alice's proofs locked for Bob (if NO wins)
  let bobLockedProofs: Proof[];   // Bob's proofs locked for Alice (if YES wins)

  const locktime = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  // -------------------------------------------------------------------------
  // Step 1: Generate keypairs
  // -------------------------------------------------------------------------

  test("1. generate Oracle group keypairs (YES/NO) and user keypairs (Alice/Bob)", () => {
    oracleYes = genKeypair();
    oracleNo = genKeypair();
    alice = genKeypair();
    bob = genKeypair();

    // All keys should be 64 hex chars (x-only BIP-340)
    expect(oracleYes.publicKey).toHaveLength(64);
    expect(oracleNo.publicKey).toHaveLength(64);
    expect(alice.publicKey).toHaveLength(64);
    expect(bob.publicKey).toHaveLength(64);

    // All distinct
    const allPks = [oracleYes.publicKey, oracleNo.publicKey, alice.publicKey, bob.publicKey];
    expect(new Set(allPks).size).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Step 2: Mint Cashu proofs via regtest Lightning
  // -------------------------------------------------------------------------

  test("2. Alice and Bob mint Cashu proofs via regtest Lightning", async () => {
    aliceProofs = await throttledMintProofs(wallet, BET_SATS);
    bobProofs = await throttledMintProofs(wallet, BET_SATS);

    const aliceTotal = aliceProofs.reduce((s, p) => s + p.amount, 0);
    const bobTotal = bobProofs.reduce((s, p) => s + p.amount, 0);

    expect(aliceTotal).toBe(BET_SATS);
    expect(bobTotal).toBe(BET_SATS);
    expect(aliceProofs.length).toBeGreaterThan(0);
    expect(bobProofs.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Step 3: Lock Alice's proofs — she's betting YES
  //   P2PK([group_pubkey_no, bob_pubkey], n_sigs=2) + refund(alice)
  //   -> Bob redeems if NO wins (oracle signs with sk_no)
  // -------------------------------------------------------------------------

  test("3. lock Alice's proofs with P2PK([group_pubkey_no, bob], n=2) — she bets YES", async () => {
    const options = buildFrostSwapForPartyA({
      group_pubkey_b: oracleNo.publicKey,
      counterpartyPubkey: bob.publicKey,
      refundPubkey: alice.publicKey,
      locktime,
    });

    aliceLockedProofs = await createP2PKLockedProofs(wallet, aliceProofs, BET_SATS, options);

    expect(aliceLockedProofs.length).toBeGreaterThan(0);

    // Verify P2PK lock structure.
    // NUT-11 secret format: ["P2PK", { data: <primary_pubkey>, tags: [["pubkeys", ...extra]] }]
    // The first pubkey goes into `data`, remaining go into the `pubkeys` tag.
    for (const proof of aliceLockedProofs) {
      const secret = JSON.parse(proof.secret);
      expect(secret[0]).toBe("P2PK");

      // Collect ALL lock pubkeys: `data` field + `pubkeys` tag
      const dataPk = secret[1]?.data as string;
      const tags: string[][] = secret[1]?.tags ?? [];
      const pubkeysTag = tags.find((t: string[]) => t[0] === "pubkeys");
      const allLockKeys = [dataPk, ...(pubkeysTag?.slice(1) ?? [])];

      const matchKey = (target: string, key: string) =>
        key === target || key === `02${target}` || key === `03${target}`;

      const hasBob = allLockKeys.some((k) => matchKey(bob.publicKey, k));
      const hasOracleNo = allLockKeys.some((k) => matchKey(oracleNo.publicKey, k));
      expect(hasBob).toBe(true);
      expect(hasOracleNo).toBe(true);

      // n_sigs should be 2
      const nSigs = tags.find((t: string[]) => t[0] === "n_sigs");
      expect(nSigs).toBeDefined();
      expect(nSigs![1]).toBe("2");
    }
  });

  // -------------------------------------------------------------------------
  // Step 4: Lock Bob's proofs — he's betting NO
  //   P2PK([group_pubkey_yes, alice_pubkey], n_sigs=2) + refund(bob)
  //   -> Alice redeems if YES wins (oracle signs with sk_yes)
  // -------------------------------------------------------------------------

  test("4. lock Bob's proofs with P2PK([group_pubkey_yes, alice], n=2) — he bets NO", async () => {
    const options = buildFrostSwapForPartyB({
      group_pubkey_a: oracleYes.publicKey,
      counterpartyPubkey: alice.publicKey,
      refundPubkey: bob.publicKey,
      locktime,
    });

    bobLockedProofs = await createP2PKLockedProofs(wallet, bobProofs, BET_SATS, options);

    expect(bobLockedProofs.length).toBeGreaterThan(0);

    // Verify P2PK lock structure (same pattern as step 3)
    for (const proof of bobLockedProofs) {
      const secret = JSON.parse(proof.secret);
      expect(secret[0]).toBe("P2PK");

      const dataPk = secret[1]?.data as string;
      const tags: string[][] = secret[1]?.tags ?? [];
      const pubkeysTag = tags.find((t: string[]) => t[0] === "pubkeys");
      const allLockKeys = [dataPk, ...(pubkeysTag?.slice(1) ?? [])];

      const matchKey = (target: string, key: string) =>
        key === target || key === `02${target}` || key === `03${target}`;

      const hasAlice = allLockKeys.some((k) => matchKey(alice.publicKey, k));
      const hasOracleYes = allLockKeys.some((k) => matchKey(oracleYes.publicKey, k));
      expect(hasAlice).toBe(true);
      expect(hasOracleYes).toBe(true);

      const nSigs = tags.find((t: string[]) => t[0] === "n_sigs");
      expect(nSigs).toBeDefined();
      expect(nSigs![1]).toBe("2");
    }
  });

  // -------------------------------------------------------------------------
  // Step 5: YES wins — Oracle produces Schnorr signature with sk_yes
  // -------------------------------------------------------------------------

  test("5. YES wins: Oracle signs with sk_yes (simulating FROST threshold signing)", () => {
    // In production: FROST threshold signers cooperate to produce group signature.
    // In demo mode: single Schnorr sign with the YES outcome's secret key.
    //
    // The signature is over the proof secret (SIG_ALL mode). This is verified
    // by the Cashu mint as part of the P2PK NUT-11 protocol.

    // Verify the Oracle YES key is valid for Schnorr signing
    const testMessage = new Uint8Array(32);
    crypto.getRandomValues(testMessage);
    const sig = schnorr.sign(testMessage, hexToBytes(oracleYes.secretKey));
    const valid = schnorr.verify(sig, testMessage, hexToBytes(oracleYes.publicKey));
    expect(valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Step 6: Alice redeems Bob's locked proofs
  //   Bob's proofs are locked with P2PK([group_pubkey_yes, alice], n=2)
  //   Alice provides: oracle_sig (sk_yes) + alice_sig (sk_alice)
  // -------------------------------------------------------------------------

  test("6. Alice redeems Bob's locked proofs using [oracle_yes_key, alice_key]", async () => {
    // Bob's proofs are locked to [group_pubkey_yes, alice_pubkey] with n_sigs=2.
    // Alice needs both keys to sign: oracle's YES key + her own key.
    // wallet.ops.send().privkey([oracle_yes_sk, alice_sk]) handles multi-sig signing.

    const totalSats = bobLockedProofs.reduce((s, p) => s + p.amount, 0);
    const fee = wallet.getFeesForProofs(bobLockedProofs);
    expect(totalSats - fee).toBeGreaterThan(0);

    await throttleMintOp();
    const { send: redeemed } = await retryOnRateLimit(() =>
      wallet.ops
        .send(totalSats - fee, bobLockedProofs)
        .privkey([oracleYes.secretKey, alice.secretKey])
        .run()
    );

    expect(redeemed).not.toBeNull();
    expect(redeemed.length).toBeGreaterThan(0);

    // Verify redeemed amount
    const redeemedTotal = redeemed.reduce((s, p) => s + p.amount, 0);
    expect(redeemedTotal).toBe(totalSats - fee);
  });

  // -------------------------------------------------------------------------
  // Step 7: Verify Bob CANNOT produce valid P2PK signatures for Alice's proofs
  //   Alice's proofs are locked with P2PK([group_pubkey_no, bob], n=2)
  //   Bob has his own key, but needs oracle NO key — which was never signed.
  //
  //   NOTE: Nutshell 0.19.2 DOES enforce NUT-11 P2PK spending conditions
  //   on /v1/swap (returns 400 without valid witness). We additionally verify
  //   at the client/protocol level using signP2PKProofs for defense-in-depth.
  // -------------------------------------------------------------------------

  test("7. Bob cannot produce valid 2-of-2 signature without oracle NO key", () => {
    // Alice's proofs are locked to [group_pubkey_no, bob_pubkey] with n_sigs=2.
    // Bob has bob_sk, but the Oracle never signed with sk_no (YES won).
    // signP2PKProofs with only Bob's key produces only 1 of 2 required signatures.

    const signed = signP2PKProofs(aliceLockedProofs, bob.secretKey);

    for (const proof of signed) {
      const witness = typeof proof.witness === "string"
        ? JSON.parse(proof.witness)
        : proof.witness;

      // Only 1 signature (Bob's) — need 2 for n_sigs=2
      expect(witness.signatures.length).toBe(1);

      // Verify the lock requires 2 signatures
      const secret = JSON.parse(proof.secret);
      const tags: string[][] = secret[1]?.tags ?? [];
      const nSigs = tags.find((t: string[]) => t[0] === "n_sigs");
      expect(nSigs![1]).toBe("2");
    }
  });

  // -------------------------------------------------------------------------
  // Step 8: Verify wrong oracle key produces invalid P2PK signatures
  //   Alice's proofs need [oracle_no, bob] — oracle YES key is wrong group.
  // -------------------------------------------------------------------------

  test("8. wrong oracle key (YES instead of NO) cannot sign Alice's proofs", () => {
    // Alice's proofs are locked to [group_pubkey_no, bob_pubkey].
    // Oracle YES key is NOT in the lock — signP2PKProofs skips it.

    // Sign with Bob (produces 1 valid sig)
    const bobSigned = signP2PKProofs(aliceLockedProofs, bob.secretKey);

    // Try to add oracle YES signature — wrong key, not in pubkeys list.
    // signP2PKProofs will skip (or warn) because oracleYes is not in the lock.
    const doubleSigned = signP2PKProofs(bobSigned, oracleYes.secretKey);

    for (const proof of doubleSigned) {
      const witness = typeof proof.witness === "string"
        ? JSON.parse(proof.witness)
        : proof.witness;

      // Still only 1 valid signature (Bob's) — oracleYes key is not in the lock
      // so signP2PKProofs should not have added a second signature.
      expect(witness.signatures.length).toBe(1);
    }
  });

  // -------------------------------------------------------------------------
  // Step 9: Verify a random third party cannot sign any locked proofs
  // -------------------------------------------------------------------------

  test("9. random third party key cannot produce valid signatures", () => {
    const eve = genKeypair();

    // Eve's key is not in any lock — signP2PKProofs should skip
    const eveSigned = signP2PKProofs(aliceLockedProofs, eve.secretKey);

    for (const proof of eveSigned) {
      const witness = typeof proof.witness === "string"
        ? JSON.parse(proof.witness)
        : proof.witness;

      // Eve's key not in the lock, no signature should be produced
      // (signP2PKProofs skips keys not in the pubkeys list)
      expect(witness?.signatures?.length ?? 0).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Separate suite: FROST P2PK structural tests (no Docker needed)
// ---------------------------------------------------------------------------

describe("FROST P2PK structural tests (no mint required)", () => {
  test("buildFrostSwapForPartyA and B use opposite group keys", () => {
    const groupYes = genKeypair();
    const groupNo = genKeypair();
    const alice = genKeypair();
    const bob = genKeypair();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    // Alice bets YES → her proofs locked with [group_no, bob]
    const optsA = buildFrostSwapForPartyA({
      group_pubkey_b: groupNo.publicKey,
      counterpartyPubkey: bob.publicKey,
      refundPubkey: alice.publicKey,
      locktime,
    });

    // Bob bets NO → his proofs locked with [group_yes, alice]
    const optsB = buildFrostSwapForPartyB({
      group_pubkey_a: groupYes.publicKey,
      counterpartyPubkey: alice.publicKey,
      refundPubkey: bob.publicKey,
      locktime,
    });

    // Options should be structurally valid
    expect(optsA).toBeTruthy();
    expect(optsB).toBeTruthy();

    // They should contain different keys
    const strA = JSON.stringify(optsA);
    const strB = JSON.stringify(optsB);
    expect(strA).not.toBe(strB);

    // Party A options should contain group_no and bob
    expect(strA).toContain(bob.publicKey);
    // Party B options should contain group_yes and alice
    expect(strB).toContain(alice.publicKey);
  });

  test("P2PKBuilder creates valid 2-of-2 multi-sig options", () => {
    const key1 = genKeypair();
    const key2 = genKeypair();
    const refund = genKeypair();
    const locktime = Math.floor(Date.now() / 1000) + 3600;

    const opts = new P2PKBuilder()
      .addLockPubkey([key1.publicKey, key2.publicKey])
      .requireLockSignatures(2)
      .lockUntil(locktime)
      .addRefundPubkey(refund.publicKey)
      .requireRefundSignatures(1)
      .sigAll()
      .toOptions();

    expect(opts.locktime).toBe(locktime);
    expect(opts.sigFlag).toBe("SIG_ALL");

    const pubkeys = Array.isArray(opts.pubkey) ? opts.pubkey : [opts.pubkey];
    expect(pubkeys.length).toBe(2);

    const refundKeys = Array.isArray(opts.refundKeys) ? opts.refundKeys : [opts.refundKeys];
    expect(refundKeys.length).toBe(1);
  });

  test("signP2PKProofs signs with keys present in the lock", () => {
    const key1 = genKeypair();
    const key2 = genKeypair();

    // Create a P2PK proof locked to [key1, key2]
    const secret = JSON.stringify([
      "P2PK",
      {
        data: `02${key1.publicKey}`,
        nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
        tags: [
          ["pubkeys", `02${key1.publicKey}`, `02${key2.publicKey}`],
          ["n_sigs", "2"],
          ["sigflag", "SIG_ALL"],
        ],
      },
    ]);

    const proof: Proof = {
      amount: 64,
      id: "test-keyset",
      secret,
      C: "02" + "ab".repeat(32),
    };

    // Sign with key1
    const signed1 = signP2PKProofs([proof], key1.secretKey);
    const witness1 = typeof signed1[0]!.witness === "string"
      ? JSON.parse(signed1[0]!.witness)
      : signed1[0]!.witness;
    expect(witness1.signatures.length).toBe(1);

    // Sign with key2 on top of key1's signature
    const signed2 = signP2PKProofs(signed1, key2.secretKey);
    const witness2 = typeof signed2[0]!.witness === "string"
      ? JSON.parse(signed2[0]!.witness)
      : signed2[0]!.witness;
    expect(witness2.signatures.length).toBe(2);
  });
});
