// prepareHtlcWitness/verifyHtlcSpendAuth are module-private in escrow.ts;
// we replicate the logic here so we can exercise it without a live Cashu mint.

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  getDecodedToken,
  getEncodedToken,
  isHTLCSpendAuthorised,
  P2PKBuilder,
  signP2PKProofs,
  verifyHTLCHash,
} from "@cashu/cashu-ts";
import type { Proof } from "@cashu/cashu-ts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { buildHtlcFinalOptions, verifyHtlcProofs } from "@anchr/sdk/payments";

function genKeypair() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { secretKey: bytesToHex(sk), publicKey: pk };
}

function sha256Hex(hexPreimage: string): string {
  const bytes = new Uint8Array(
    hexPreimage.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  return bytesToHex(sha256(bytes));
}

function randomPreimage(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

// NUT-14 secret format: ["HTLC", { data: <hash>, nonce, tags: [...] }]
function makeHtlcProof(params: {
  hash: string;
  workerPubkey: string;
  refundPubkey: string;
  locktime: number;
  amount?: number;
}): Proof {
  const { hash, workerPubkey, refundPubkey, locktime, amount = 64 } = params;

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

function prepareHtlcWitness(
  proofs: Proof[],
  preimage: string,
  workerPrivateKey: string,
): Proof[] {
  const proofsWithPreimage = proofs.map((p) => ({
    ...p,
    witness: JSON.stringify({ preimage, signatures: [] }),
  }));
  return signP2PKProofs(proofsWithPreimage, workerPrivateKey);
}

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
    expect(witness.signatures[0].length).toBe(128); // 64-byte Schnorr
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
      makeHtlcProof({
        hash,
        workerPubkey: worker.publicKey,
        refundPubkey: requester.publicKey,
        locktime,
        amount: 32,
      }),
      makeHtlcProof({
        hash,
        workerPubkey: worker.publicKey,
        refundPubkey: requester.publicKey,
        locktime,
        amount: 32,
      }),
    ];

    const signed = prepareHtlcWitness(proofs, preimage, worker.secretKey);

    expect(signed).toHaveLength(2);
    for (const s of signed) {
      const witness = typeof s.witness === "string"
        ? JSON.parse(s.witness)
        : s.witness;
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

    // cashu-ts signP2PKProofs with a key not in the pubkeys list either logs
    // and returns unsigned, or signs with a useless key — either way the
    // resulting proof must not pass spend authorization.
    const signed = prepareHtlcWitness([proof], preimage, impostor.secretKey);

    const witness = typeof signed[0]!.witness === "string"
      ? JSON.parse(signed[0]!.witness)
      : signed[0]!.witness;

    if (witness.signatures.length === 0) {
      expect(isHTLCSpendAuthorised(signed[0]!)).toBe(false);
    } else {
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
      hash: otherHash,
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
    expect(result).not.toBeNull();
    expect(result).toContain("Preimage does not match expected hash");
  });

  test("returns null for empty proofs array with correct preimage", () => {
    const result = verifyHtlcProofs([], hash, preimage);
    expect(result).toBeNull();
  });

  test("multi-proof: all valid returns null", () => {
    const proofs = [
      makeHtlcProof({
        hash,
        workerPubkey: worker.publicKey,
        refundPubkey: requester.publicKey,
        locktime,
        amount: 32,
      }),
      makeHtlcProof({
        hash,
        workerPubkey: worker.publicKey,
        refundPubkey: requester.publicKey,
        locktime,
        amount: 32,
      }),
    ];

    const result = verifyHtlcProofs(proofs, hash, preimage);
    expect(result).toBeNull();
  });

  test("multi-proof: one with wrong hash returns error", () => {
    const otherHash = sha256Hex(randomPreimage());
    const proofs = [
      makeHtlcProof({
        hash,
        workerPubkey: worker.publicKey,
        refundPubkey: requester.publicKey,
        locktime,
      }),
      makeHtlcProof({
        hash: otherHash,
        workerPubkey: worker.publicKey,
        refundPubkey: requester.publicKey,
        locktime,
      }),
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

    const refundKeys = Array.isArray(opts.refundKeys)
      ? opts.refundKeys
      : [opts.refundKeys];
    expect(refundKeys).toContain(`02${requester.publicKey}`);
  });
});
