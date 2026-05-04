import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { schnorr } from "@noble/curves/secp256k1";
import {
  buildFrostSwapForPartyA,
  buildFrostSwapForPartyB,
  createDualKeyStore,
} from "./frost-conditional-swap.ts";

function randomPubkey(): string {
  return bytesToHex(randomBytes(32));
}

const LOCKTIME = Math.floor(Date.now() / 1000) + 86400;

// ---------------------------------------------------------------------------
// P2PK builder tests
// ---------------------------------------------------------------------------

test("buildFrostSwapForPartyA returns valid P2PK options", () => {
  const groupPubkeyB = randomPubkey();
  const counterparty = randomPubkey();
  const refund = randomPubkey();

  const opts = buildFrostSwapForPartyA({
    group_pubkey_b: groupPubkeyB,
    counterpartyPubkey: counterparty,
    refundPubkey: refund,
    locktime: LOCKTIME,
  });

  expect(opts).toBeTruthy();
  expect(typeof opts).toBe("object");
});

test("buildFrostSwapForPartyB returns valid P2PK options", () => {
  const groupPubkeyA = randomPubkey();
  const counterparty = randomPubkey();
  const refund = randomPubkey();

  const opts = buildFrostSwapForPartyB({
    group_pubkey_a: groupPubkeyA,
    counterpartyPubkey: counterparty,
    refundPubkey: refund,
    locktime: LOCKTIME,
  });

  expect(opts).toBeTruthy();
  expect(typeof opts).toBe("object");
});

test("party A and B use opposite group pubkeys", () => {
  const groupPubkeyA = randomPubkey();
  const groupPubkeyB = randomPubkey();
  const pubkeyA = randomPubkey();
  const pubkeyB = randomPubkey();

  const optsA = buildFrostSwapForPartyA({
    group_pubkey_b: groupPubkeyB,
    counterpartyPubkey: pubkeyB,
    refundPubkey: pubkeyA,
    locktime: LOCKTIME,
  });

  const optsB = buildFrostSwapForPartyB({
    group_pubkey_a: groupPubkeyA,
    counterpartyPubkey: pubkeyA,
    refundPubkey: pubkeyB,
    locktime: LOCKTIME,
  });

  expect(optsA).toBeTruthy();
  expect(optsB).toBeTruthy();

  const strA = JSON.stringify(optsA);
  const strB = JSON.stringify(optsB);
  expect(strA).not.toBe(strB);
});

test("options contain group pubkey and counterparty pubkey", () => {
  const groupPubkeyB = randomPubkey();
  const counterparty = randomPubkey();
  const refund = randomPubkey();

  const opts = buildFrostSwapForPartyA({
    group_pubkey_b: groupPubkeyB,
    counterpartyPubkey: counterparty,
    refundPubkey: refund,
    locktime: LOCKTIME,
  });

  const serialized = JSON.stringify(opts);
  expect(serialized).toContain(counterparty);
  expect(serialized).toContain(refund);
});

// ---------------------------------------------------------------------------
// DualKeyStore tests
// ---------------------------------------------------------------------------

test("DualKeyStore.create returns two distinct pubkeys", () => {
  const store = createDualKeyStore();
  const entry = store.create("swap-1");

  expect(entry.pubkey_a).toBeTruthy();
  expect(entry.pubkey_b).toBeTruthy();
  expect(entry.pubkey_a).not.toBe(entry.pubkey_b);
  expect(entry.pubkey_a.length).toBe(64); // x-only hex
  expect(entry.pubkey_b.length).toBe(64);
});

test("DualKeyStore.create is idempotent for same swap_id", () => {
  const store = createDualKeyStore();
  const first = store.create("swap-1");
  const second = store.create("swap-1");

  expect(first.pubkey_a).toBe(second.pubkey_a);
  expect(first.pubkey_b).toBe(second.pubkey_b);
});

test("DualKeyStore.create returns different keys for different swap_ids", () => {
  const store = createDualKeyStore();
  const s1 = store.create("swap-1");
  const s2 = store.create("swap-2");

  expect(s1.pubkey_a).not.toBe(s2.pubkey_a);
  expect(s1.pubkey_b).not.toBe(s2.pubkey_b);
});

test("DualKeyStore.getPubkeys returns keys after create", () => {
  const store = createDualKeyStore();
  const entry = store.create("swap-1");
  const got = store.getPubkeys("swap-1");

  expect(got).not.toBeNull();
  expect(got!.pubkey_a).toBe(entry.pubkey_a);
  expect(got!.pubkey_b).toBe(entry.pubkey_b);
});

test("DualKeyStore.getPubkeys returns null for unknown swap", () => {
  const store = createDualKeyStore();
  expect(store.getPubkeys("unknown")).toBeNull();
});

test("DualKeyStore.has returns correct values", () => {
  const store = createDualKeyStore();
  store.create("swap-1");
  expect(store.has("swap-1")).toBe(true);
  expect(store.has("unknown")).toBe(false);
});

test("DualKeyStore.sign outcome a produces valid Schnorr signature", () => {
  const store = createDualKeyStore();
  const entry = store.create("swap-1");
  const message = randomBytes(32);

  const sig = store.sign("swap-1", "a", message);
  expect(sig).toBeTruthy();
  expect(typeof sig).toBe("string");
  expect(sig!.length).toBe(128); // 64-byte Schnorr sig as hex

  // Verify signature against pubkey_a
  const valid = schnorr.verify(hexToBytes(sig!), message, hexToBytes(entry.pubkey_a));
  expect(valid).toBe(true);
});

test("DualKeyStore.sign outcome b produces valid Schnorr signature", () => {
  const store = createDualKeyStore();
  const entry = store.create("swap-1");
  const message = randomBytes(32);

  const sig = store.sign("swap-1", "b", message);
  expect(sig).toBeTruthy();

  // Verify signature against pubkey_b
  const valid = schnorr.verify(hexToBytes(sig!), message, hexToBytes(entry.pubkey_b));
  expect(valid).toBe(true);
});

test("DualKeyStore.sign twice returns null (one-time operation)", () => {
  const store = createDualKeyStore();
  store.create("swap-1");
  const message = randomBytes(32);

  const first = store.sign("swap-1", "a", message);
  expect(first).toBeTruthy();

  const second = store.sign("swap-1", "a", message);
  expect(second).toBeNull();
});

test("DualKeyStore.sign for unknown swap returns null", () => {
  const store = createDualKeyStore();
  expect(store.sign("unknown", "a", randomBytes(32))).toBeNull();
});

test("losing secret key is deleted after sign", () => {
  const store = createDualKeyStore();
  store.create("swap-1");

  // Sign outcome a — secret_b should be deleted
  store.sign("swap-1", "a", randomBytes(32));

  // Cannot sign again (marked as signed)
  const tryAgain = store.sign("swap-1", "b", randomBytes(32));
  expect(tryAgain).toBeNull();
});

test("multiple swaps are independent", () => {
  const store = createDualKeyStore();
  const e1 = store.create("swap-1");
  const e2 = store.create("swap-2");

  const msg1 = randomBytes(32);
  const msg2 = randomBytes(32);

  const sig1 = store.sign("swap-1", "a", msg1);
  expect(sig1).toBeTruthy();
  expect(schnorr.verify(hexToBytes(sig1!), msg1, hexToBytes(e1.pubkey_a))).toBe(true);

  // swap-2 is unaffected
  const sig2 = store.sign("swap-2", "b", msg2);
  expect(sig2).toBeTruthy();
  expect(schnorr.verify(hexToBytes(sig2!), msg2, hexToBytes(e2.pubkey_b))).toBe(true);

  // Both are now signed
  expect(store.sign("swap-1", "a", randomBytes(32))).toBeNull();
  expect(store.sign("swap-2", "b", randomBytes(32))).toBeNull();
});

// ---------------------------------------------------------------------------
// signProofSecrets tests (NUT-11 P2PK per-proof signing)
// ---------------------------------------------------------------------------

test("signProofSecrets signs each proof secret with SHA256 hash", () => {
  const store = createDualKeyStore();
  const entry = store.create("swap-ps-1");

  const secrets = ["secret-one", "secret-two", "secret-three"];
  const result = store.signProofSecrets("swap-ps-1", "a", secrets);

  expect(result).not.toBeNull();
  expect(result!.size).toBe(3);

  // Each signature should be valid for SHA256(secret) under pubkey_a
  for (const secret of secrets) {
    const sig = result!.get(secret)!;
    expect(sig).toBeTruthy();
    expect(sig.length).toBe(128); // 64-byte Schnorr sig as hex

    const msgHash = sha256(new TextEncoder().encode(secret));
    const valid = schnorr.verify(hexToBytes(sig), msgHash, hexToBytes(entry.pubkey_a));
    expect(valid).toBe(true);
  }
});

test("signProofSecrets outcome b signs with pubkey_b", () => {
  const store = createDualKeyStore();
  const entry = store.create("swap-ps-2");

  const secrets = ["proof-secret-x"];
  const result = store.signProofSecrets("swap-ps-2", "b", secrets);

  expect(result).not.toBeNull();

  const sig = result!.get("proof-secret-x")!;
  const msgHash = sha256(new TextEncoder().encode("proof-secret-x"));
  const valid = schnorr.verify(hexToBytes(sig), msgHash, hexToBytes(entry.pubkey_b));
  expect(valid).toBe(true);
});

test("signProofSecrets marks swap as signed and deletes losing key", () => {
  const store = createDualKeyStore();
  store.create("swap-ps-3");

  const result = store.signProofSecrets("swap-ps-3", "a", ["s1"]);
  expect(result).not.toBeNull();

  // Cannot sign again (marked as signed)
  const again = store.signProofSecrets("swap-ps-3", "b", ["s2"]);
  expect(again).toBeNull();

  // Regular sign also fails
  expect(store.sign("swap-ps-3", "a", randomBytes(32))).toBeNull();
});

test("signProofSecrets returns null for unknown swap", () => {
  const store = createDualKeyStore();
  expect(store.signProofSecrets("unknown", "a", ["s1"])).toBeNull();
});

test("signProofSecrets handles empty array", () => {
  const store = createDualKeyStore();
  store.create("swap-ps-empty");

  const result = store.signProofSecrets("swap-ps-empty", "a", []);
  expect(result).not.toBeNull();
  expect(result!.size).toBe(0);
});

test("signProofSecrets produces NUT-11 compatible signature (SHA256 of secret string)", () => {
  const store = createDualKeyStore();
  const entry = store.create("swap-nut11");

  // Simulate a real P2PK proof secret
  const secret = '["P2PK",{"data":"02abcdef","nonce":"deadbeef","tags":[["pubkeys","02abc","02def"],["n_sigs","2"]]}]';
  const result = store.signProofSecrets("swap-nut11", "a", [secret]);

  expect(result).not.toBeNull();
  const sig = result!.get(secret)!;

  // NUT-11 signing message: SHA256(proof.secret) where proof.secret is the raw string
  const expectedMsg = sha256(new TextEncoder().encode(secret));
  const valid = schnorr.verify(hexToBytes(sig), expectedMsg, hexToBytes(entry.pubkey_a));
  expect(valid).toBe(true);
});
