import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getEncodedToken, type Proof } from "@cashu/cashu-ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  deriveFrostEscrowTokenHash,
  deriveFrostP2pkMessages,
  tokenMatchesFrostP2pkLock,
} from "./signing-message.ts";

const GROUP_PUB =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PROVIDER_PUB =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REFUND_PUB =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const KEYSET_ID = "00ad268c4d1f5826";

const textEncoder = new TextEncoder();

function sha256Utf8Hex(value: string): string {
  return bytesToHex(sha256(textEncoder.encode(value)));
}

function makeP2pkProof(secret: string, amount: number): Proof {
  return {
    amount,
    id: KEYSET_ID,
    secret,
    C: "02" + String(amount).padStart(2, "0").repeat(32),
  };
}

function makeP2pkSecret(params: {
  groupPubkey: string;
  nSigs: string;
}): string {
  return JSON.stringify([
    "P2PK",
    {
      data: `02${PROVIDER_PUB}`,
      nonce: "testnonce",
      tags: [
        ["pubkeys", `02${params.groupPubkey}`],
        ["n_sigs", params.nSigs],
        ["refund", `02${REFUND_PUB}`],
        ["sigflag", "SIG_INPUTS"],
      ],
    },
  ]);
}

function encode(proofs: Proof[]): string {
  return getEncodedToken({ mint: "https://mint.example", proofs }, {
    version: 4,
  });
}

describe("FROST P2PK signing messages", () => {
  test("derives one sha256(secret) message per token proof", () => {
    const secret1 = makeP2pkSecret({ groupPubkey: GROUP_PUB, nSigs: "2" });
    const secret2 = makeP2pkSecret({ groupPubkey: GROUP_PUB, nSigs: "2" });
    const token = encode([
      makeP2pkProof(secret1, 1),
      makeP2pkProof(secret2, 2),
    ]);

    expect(deriveFrostP2pkMessages(token)).toEqual([
      sha256Utf8Hex(secret1),
      sha256Utf8Hex(secret2),
    ]);
  });

  test("hashes the encoded escrow token for requirement binding", () => {
    const token = encode([
      makeP2pkProof(
        makeP2pkSecret({ groupPubkey: GROUP_PUB, nSigs: "2" }),
        1,
      ),
    ]);

    expect(deriveFrostEscrowTokenHash(token)).toBe(sha256Utf8Hex(token));
  });

  test("accepts only P2PK locks that include the group key with n_sigs=2", () => {
    const valid = encode([
      makeP2pkProof(
        makeP2pkSecret({ groupPubkey: GROUP_PUB, nSigs: "2" }),
        1,
      ),
    ]);
    const wrongGroup = encode([
      makeP2pkProof(
        makeP2pkSecret({ groupPubkey: "dd".repeat(32), nSigs: "2" }),
        1,
      ),
    ]);
    const oneSignature = encode([
      makeP2pkProof(
        makeP2pkSecret({ groupPubkey: GROUP_PUB, nSigs: "1" }),
        1,
      ),
    ]);

    expect(tokenMatchesFrostP2pkLock(valid, GROUP_PUB)).toBe(true);
    expect(tokenMatchesFrostP2pkLock(wrongGroup, GROUP_PUB)).toBe(false);
    expect(tokenMatchesFrostP2pkLock(oneSignature, GROUP_PUB)).toBe(false);
  });
});
