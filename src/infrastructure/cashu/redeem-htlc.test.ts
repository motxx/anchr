/**
 * Unit tests for redeemHtlcToken witness preparation logic.
 *
 * The redeemHtlcToken() function in escrow.ts is tightly coupled to the Cashu
 * mint (via getWalletAndConfig / loadAndSend). We extract and test the two pure
 * helper functions it delegates to:
 *
 *   - prepareHtlcWitness: attaches preimage + P2PK signature to each proof
 *   - verifyHtlcSpendAuth: validates HTLC spending conditions locally
 *
 * Since these helpers are module-private, we replicate their logic here and test
 * the same behavior. We also exercise verifyHtlcProofs (the public verification
 * function) and the P2PK builder options used for HTLC tokens.
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  getEncodedToken,
  getDecodedToken,
  P2PKBuilder,
  signP2PKProofs,
  isHTLCSpendAuthorised,
  verifyHTLCHash,
} from "@cashu/cashu-ts";
import type { Proof } from "@cashu/cashu-ts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  buildHtlcFinalOptions,
  verifyHtlcProofs,
} from "./escrow.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a nostr-style hex keypair. */
function genKeypair() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { secretKey: bytesToHex(sk), publicKey: pk };
}

/** Compute SHA-256 hash of a hex preimage, returning hex. */
function sha256Hex(hexPreimage: string): string {
  const bytes = new Uint8Array(hexPreimage.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return bytesToHex(sha256(bytes));
}

/** Generate a random hex preimage (32 bytes). */
function randomPreimage(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Create a crafted HTLC proof with a structured secret.
 *
 * The secret follows NUT-14 format:
 *   ["HTLC", { data: <hash>, nonce: <nonce>, tags: [...] }]
 */
function makeHtlcProof(params: {
  hash: string;
  workerPubkey: string;
  refundPubkey: string;
  locktime: number;
  amount?: number;
}): Proof {
  const { hash, workerPubkey, refundPubkey, locktime, amount = 64 } = params;

  // Build secret using NUT-14 HTLC format
  const secret = JSON.stringify([
    "HTLC",
    {
      data: hash,
      nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
      tags: [
        ["pubkeys", `02${workerPubkey}`],
        ["locktime", String(locktime)],
        ["n_sigs", "1"],
        ["refund", `02${refundPubkey}`],
        ["sigflag", "SIG_ALL"],
      ],
    },
  ]);

  return {
    amount,
    id: "test-keyset-001",
    secret,
    C: "02" + "ab".repeat(32),
  };
}

/**
 * Replicate prepareHtlcWitness from escrow.ts:
 *   1. Attach preimage as HTLC witness on each proof
 *   2. Sign proofs with worker's private key (P2PK)
 */
function prepareHtlcWitness(proofs: Proof[], preimage: string, workerPrivateKey: string): Proof[] {
  const proofsWithPreimage = proofs.map((p) => ({
    ...p,
    witness: JSON.stringify({ preimage, signatures: [] }),
  }));
  return signP2PKProofs(proofsWithPreimage, workerPrivateKey);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("redeemHtlcToken — witness preparation", () => {
  const worker = genKeypair();
  const requester = genKeypair();
  const preimage = randomPreimage();
  const hash = sha256Hex(preimage);
  const locktime = Math.floor(Date.now() / 1000) + 3600;

  test("prepareHtlcWitness attaches preimage to each proof", () => {
    const proof = makeHtlcProof({
      hash,
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
    });

    const signed = prepareHtlcWitness([proof], preimage, worker.secretKey);

    expect(signed).toHaveLength(1);
    const witness = typeof signed[0]!.witness === "string"
      ? JSON.parse(signed[0]!.witness)
      : signed[0]!.witness;
    expect(witness.preimage).toBe(preimage);
  });

  test("prepareHtlcWitness adds P2PK signature from worker key", () => {
    const proof = makeHtlcProof({
      hash,
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
    });

    const signed = prepareHtlcWitness([proof], preimage, worker.secretKey);

    const witness = typeof signed[0]!.witness === "string"
      ? JSON.parse(signed[0]!.witness)
      : signed[0]!.witness;
    expect(witness.signatures).toBeDefined();
    expect(Array.isArray(witness.signatures)).toBe(true);
    expect(witness.signatures.length).toBeGreaterThan(0);
    // Each signature should be a hex string (64-byte Schnorr = 128 hex chars)
    expect(witness.signatures[0].length).toBe(128);
  });

  test("prepareHtlcWitness preserves proof amount and secret", () => {
    const proof = makeHtlcProof({
      hash,
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
      amount: 128,
    });

    const signed = prepareHtlcWitness([proof], preimage, worker.secretKey);

    expect(signed[0]!.amount).toBe(128);
    expect(signed[0]!.secret).toBe(proof.secret);
    expect(signed[0]!.C).toBe(proof.C);
    expect(signed[0]!.id).toBe(proof.id);
  });

  test("prepareHtlcWitness handles multiple proofs", () => {
    const proofs = [
      makeHtlcProof({ hash, workerPubkey: worker.publicKey, refundPubkey: requester.publicKey, locktime, amount: 32 }),
      makeHtlcProof({ hash, workerPubkey: worker.publicKey, refundPubkey: requester.publicKey, locktime, amount: 32 }),
    ];

    const signed = prepareHtlcWitness(proofs, preimage, worker.secretKey);

    expect(signed).toHaveLength(2);
    for (const s of signed) {
      const witness = typeof s.witness === "string" ? JSON.parse(s.witness) : s.witness;
      expect(witness.preimage).toBe(preimage);
      expect(witness.signatures.length).toBeGreaterThan(0);
    }
  });

  test("signed proofs pass isHTLCSpendAuthorised", () => {
    const proof = makeHtlcProof({
      hash,
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
    });

    const signed = prepareHtlcWitness([proof], preimage, worker.secretKey);

    // cashu-ts isHTLCSpendAuthorised verifies witness against HTLC conditions
    expect(isHTLCSpendAuthorised(signed[0]!)).toBe(true);
  });
});

describe("redeemHtlcToken — invalid token handling", () => {
  const worker = genKeypair();
  const requester = genKeypair();
  const preimage = randomPreimage();
  const hash = sha256Hex(preimage);
  const locktime = Math.floor(Date.now() / 1000) + 3600;

  test("wrong preimage fails isHTLCSpendAuthorised", () => {
    const proof = makeHtlcProof({
      hash,
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
    });

    const wrongPreimage = randomPreimage();
    const signed = prepareHtlcWitness([proof], wrongPreimage, worker.secretKey);

    // The preimage doesn't match the hash, so HTLC spend should not be authorized
    expect(isHTLCSpendAuthorised(signed[0]!)).toBe(false);
  });

  test("wrong worker key fails signP2PKProofs (key not in pubkeys list)", () => {
    const proof = makeHtlcProof({
      hash,
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
    });

    const impostor = genKeypair();

    // signP2PKProofs with wrong key: the function should either throw or
    // produce proofs that fail spend authorization.
    // cashu-ts signP2PKProofs logs a warning and returns the proof unsigned
    // when the key isn't in the pubkeys list.
    const signed = prepareHtlcWitness([proof], preimage, impostor.secretKey);

    // The witness should either have no signatures or fail authorization
    const witness = typeof signed[0]!.witness === "string"
      ? JSON.parse(signed[0]!.witness)
      : signed[0]!.witness;

    // If signP2PKProofs skipped signing (key not in lock), signatures is empty
    if (witness.signatures.length === 0) {
      expect(isHTLCSpendAuthorised(signed[0]!)).toBe(false);
    } else {
      // If it signed anyway (some versions don't check), the HTLC auth
      // should still fail because the signature doesn't match a required pubkey
      expect(isHTLCSpendAuthorised(signed[0]!)).toBe(false);
    }
  });

  test("proof without HTLC secret is not recognized by verifyHtlcProofs", () => {
    const plainProof: Proof = {
      amount: 64,
      id: "test-keyset",
      secret: "plain-secret-not-htlc",
      C: "02" + "cd".repeat(32),
    };

    const result = verifyHtlcProofs([plainProof], hash, preimage);
    expect(result).not.toBeNull();
    expect(result).toContain("invalid secret format");
  });

  test("proof with P2PK (not HTLC) secret fails verifyHtlcProofs", () => {
    const p2pkSecret = JSON.stringify([
      "P2PK",
      {
        data: `02${worker.publicKey}`,
        nonce: "testnonce",
        tags: [],
      },
    ]);
    const proof: Proof = {
      amount: 64,
      id: "test-keyset",
      secret: p2pkSecret,
      C: "02" + "ef".repeat(32),
    };

    const result = verifyHtlcProofs([proof], hash, preimage);
    expect(result).not.toBeNull();
    expect(result).toContain("not an HTLC proof");
  });
});

describe("redeemHtlcToken — missing preimage error", () => {
  const worker = genKeypair();
  const requester = genKeypair();
  const preimage = randomPreimage();
  const hash = sha256Hex(preimage);
  const locktime = Math.floor(Date.now() / 1000) + 3600;

  test("empty preimage string fails HTLC authorization", () => {
    const proof = makeHtlcProof({
      hash,
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
    });

    const signed = prepareHtlcWitness([proof], "", worker.secretKey);
    expect(isHTLCSpendAuthorised(signed[0]!)).toBe(false);
  });

  test("verifyHTLCHash rejects wrong preimage", () => {
    const wrongPreimage = randomPreimage();
    expect(verifyHTLCHash(wrongPreimage, hash)).toBe(false);
  });

  test("verifyHTLCHash accepts correct preimage", () => {
    expect(verifyHTLCHash(preimage, hash)).toBe(true);
  });
});

describe("verifyHtlcProofs — public verification function", () => {
  const worker = genKeypair();
  const requester = genKeypair();
  const preimage = randomPreimage();
  const hash = sha256Hex(preimage);
  const locktime = Math.floor(Date.now() / 1000) + 3600;

  test("returns null for valid HTLC proof with correct hash", () => {
    const proof = makeHtlcProof({
      hash,
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
    });

    const result = verifyHtlcProofs([proof], hash, preimage);
    expect(result).toBeNull();
  });

  test("returns error for hashlock mismatch", () => {
    const otherPreimage = randomPreimage();
    const otherHash = sha256Hex(otherPreimage);
    const proof = makeHtlcProof({
      hash: otherHash, // proof locked with different hash
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
    });

    const result = verifyHtlcProofs([proof], hash, preimage);
    expect(result).not.toBeNull();
    expect(result).toContain("hashlock mismatch");
  });

  test("returns error when preimage does not match expected hash", () => {
    const proof = makeHtlcProof({
      hash,
      workerPubkey: worker.publicKey,
      refundPubkey: requester.publicKey,
      locktime,
    });

    const wrongPreimage = randomPreimage();
    const result = verifyHtlcProofs([proof], hash, wrongPreimage);
    expect(result).not.toBeNull();
    expect(result).toContain("Preimage does not match expected hash");
  });

  test("returns error for empty proofs array with wrong preimage", () => {
    const wrongPreimage = randomPreimage();
    const result = verifyHtlcProofs([], hash, wrongPreimage);
    // verifyHTLCHash check happens first, fails for wrong preimage
    expect(result).not.toBeNull();
    expect(result).toContain("Preimage does not match expected hash");
  });

  test("returns null for empty proofs array with correct preimage", () => {
    // No proofs to check = vacuously valid
    const result = verifyHtlcProofs([], hash, preimage);
    expect(result).toBeNull();
  });

  test("multi-proof: all valid returns null", () => {
    const proofs = [
      makeHtlcProof({ hash, workerPubkey: worker.publicKey, refundPubkey: requester.publicKey, locktime, amount: 32 }),
      makeHtlcProof({ hash, workerPubkey: worker.publicKey, refundPubkey: requester.publicKey, locktime, amount: 32 }),
    ];

    const result = verifyHtlcProofs(proofs, hash, preimage);
    expect(result).toBeNull();
  });

  test("multi-proof: one with wrong hash returns error", () => {
    const otherHash = sha256Hex(randomPreimage());
    const proofs = [
      makeHtlcProof({ hash, workerPubkey: worker.publicKey, refundPubkey: requester.publicKey, locktime }),
      makeHtlcProof({ hash: otherHash, workerPubkey: worker.publicKey, refundPubkey: requester.publicKey, locktime }),
    ];

    const result = verifyHtlcProofs(proofs, hash, preimage);
    expect(result).not.toBeNull();
    expect(result).toContain("hashlock mismatch");
  });
});

describe("buildHtlcFinalOptions — P2PK options for HTLC", () => {
  const worker = genKeypair();
  const requester = genKeypair();
  const hash = sha256Hex(randomPreimage());
  const locktime = Math.floor(Date.now() / 1000) + 3600;

  test("includes hashlock in options", () => {
    const opts = buildHtlcFinalOptions({
      hash,
      workerPubkey: worker.publicKey,
      requesterRefundPubkey: requester.publicKey,
      locktimeSeconds: locktime,
    });

    expect(opts.hashlock).toBe(hash);
  });

  test("includes worker pubkey with 02 prefix", () => {
    const opts = buildHtlcFinalOptions({
      hash,
      workerPubkey: worker.publicKey,
      requesterRefundPubkey: requester.publicKey,
      locktimeSeconds: locktime,
    });

    const pubkeys = Array.isArray(opts.pubkey) ? opts.pubkey : [opts.pubkey];
    expect(pubkeys).toContain(`02${worker.publicKey}`);
  });

  test("includes locktime and SIG_ALL flag", () => {
    const opts = buildHtlcFinalOptions({
      hash,
      workerPubkey: worker.publicKey,
      requesterRefundPubkey: requester.publicKey,
      locktimeSeconds: locktime,
    });

    expect(opts.locktime).toBe(locktime);
    expect(opts.sigFlag).toBe("SIG_ALL");
  });

  test("includes requester as refund key", () => {
    const opts = buildHtlcFinalOptions({
      hash,
      workerPubkey: worker.publicKey,
      requesterRefundPubkey: requester.publicKey,
      locktimeSeconds: locktime,
    });

    const refundKeys = Array.isArray(opts.refundKeys) ? opts.refundKeys : [opts.refundKeys];
    expect(refundKeys).toContain(`02${requester.publicKey}`);
  });
});
