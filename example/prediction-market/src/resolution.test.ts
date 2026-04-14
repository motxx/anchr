import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { schnorr } from "@noble/curves/secp256k1";
import { createDualPreimageStore } from "../../../src/infrastructure/conditional-swap/dual-preimage-store.ts";
import { createDualKeyStore } from "../../../src/infrastructure/conditional-swap/frost-conditional-swap.ts";
import { resolveMarket, resolveMarketFrostPerProof } from "./resolution.ts";

test("resolveMarket YES maps to outcome a", () => {
  const store = createDualPreimageStore();
  store.create("market-1");

  const result = resolveMarket("market-1", "yes", store);

  expect(result).not.toBeNull();
  expect(result!.outcome).toBe("yes");
  expect(result!.preimage).toBeTruthy();
  expect(result!.preimage.length).toBe(64);
});

test("resolveMarket NO maps to outcome b", () => {
  const store = createDualPreimageStore();
  store.create("market-1");

  const result = resolveMarket("market-1", "no", store);

  expect(result).not.toBeNull();
  expect(result!.outcome).toBe("no");
  expect(result!.preimage).toBeTruthy();
});

test("resolveMarket returns different preimages for YES vs NO", () => {
  const storeYes = createDualPreimageStore();
  storeYes.create("m-yes");
  const resultYes = resolveMarket("m-yes", "yes", storeYes);

  const storeNo = createDualPreimageStore();
  storeNo.create("m-no");
  const resultNo = resolveMarket("m-no", "no", storeNo);

  expect(resultYes!.preimage).not.toBe(resultNo!.preimage);
});

test("resolveMarket returns null for unknown market_id", () => {
  const store = createDualPreimageStore();
  const result = resolveMarket("unknown", "yes", store);
  expect(result).toBeNull();
});

test("resolveMarket returns null on double resolve", () => {
  const store = createDualPreimageStore();
  store.create("market-1");

  const first = resolveMarket("market-1", "yes", store);
  expect(first).not.toBeNull();

  const second = resolveMarket("market-1", "no", store);
  expect(second).toBeNull();
});

test("losing preimage cannot be recovered after resolve", () => {
  const store = createDualPreimageStore();
  const { hash_a, hash_b } = store.create("market-1");

  // Resolve YES → preimage_a revealed, preimage_b deleted
  const result = resolveMarket("market-1", "yes", store);
  expect(result).not.toBeNull();

  // Store is now marked as revealed — no further reveals possible
  // This guarantees the losing side's preimage is irrecoverable
  expect(store.reveal("market-1", "b")).toBeNull();
  expect(store.reveal("market-1", "a")).toBeNull();
});

// ---------------------------------------------------------------------------
// Per-proof FROST resolution tests (NUT-11 P2PK)
// ---------------------------------------------------------------------------

test("resolveMarketFrostPerProof signs each proof secret individually", () => {
  const keyStore = createDualKeyStore();
  keyStore.create("market-frost-1");
  const pubkeys = keyStore.getPubkeys("market-frost-1")!;

  const proofSecrets = [
    '["P2PK",{"data":"02abc","nonce":"n1","tags":[]}]',
    '["P2PK",{"data":"02def","nonce":"n2","tags":[]}]',
    '["P2PK",{"data":"02ghi","nonce":"n3","tags":[]}]',
  ];

  const result = resolveMarketFrostPerProof("market-frost-1", "yes", proofSecrets, keyStore);

  expect(result).not.toBeNull();
  expect(result!.outcome).toBe("yes");
  expect(result!.proof_signatures.size).toBe(3);

  // Each signature should be valid for SHA256(proof.secret) under pubkey_a
  for (const [secret, sig] of result!.proof_signatures) {
    const msgHash = sha256(new TextEncoder().encode(secret));
    const valid = schnorr.verify(hexToBytes(sig), msgHash, hexToBytes(pubkeys.pubkey_a));
    expect(valid).toBe(true);
  }
});

test("resolveMarketFrostPerProof NO outcome signs with pubkey_b", () => {
  const keyStore = createDualKeyStore();
  keyStore.create("market-frost-2");
  const pubkeys = keyStore.getPubkeys("market-frost-2")!;

  const proofSecrets = [
    '["P2PK",{"data":"02xyz","nonce":"n4","tags":[]}]',
  ];

  const result = resolveMarketFrostPerProof("market-frost-2", "no", proofSecrets, keyStore);

  expect(result).not.toBeNull();
  expect(result!.outcome).toBe("no");
  expect(result!.proof_signatures.size).toBe(1);

  const [secret, sig] = [...result!.proof_signatures.entries()][0]!;
  const msgHash = sha256(new TextEncoder().encode(secret));
  const valid = schnorr.verify(hexToBytes(sig), msgHash, hexToBytes(pubkeys.pubkey_b));
  expect(valid).toBe(true);
});

test("resolveMarketFrostPerProof returns null for unknown market", () => {
  const keyStore = createDualKeyStore();
  const result = resolveMarketFrostPerProof("unknown", "yes", ["secret1"], keyStore);
  expect(result).toBeNull();
});

test("resolveMarketFrostPerProof signature matches NUT-11 format (SHA256 of secret)", () => {
  const keyStore = createDualKeyStore();
  keyStore.create("market-nut11");
  const pubkeys = keyStore.getPubkeys("market-nut11")!;

  // This is what a real NUT-11 P2PK proof secret looks like
  const realSecret = '["P2PK",{"data":"02abc123","nonce":"deadbeef","tags":[["pubkeys","02abc","02def"],["n_sigs","2"],["sigflag","SIG_ALL"]]}]';

  const result = resolveMarketFrostPerProof("market-nut11", "yes", [realSecret], keyStore);
  expect(result).not.toBeNull();

  const sig = result!.proof_signatures.get(realSecret)!;
  expect(sig).toBeTruthy();
  expect(sig.length).toBe(128); // 64-byte Schnorr sig as hex

  // Verify: the signing message must be SHA256(proof.secret) as bytes
  // This is exactly what cashu-ts signP2PKProofs does internally
  const expectedMsg = sha256(new TextEncoder().encode(realSecret));
  const valid = schnorr.verify(hexToBytes(sig), expectedMsg, hexToBytes(pubkeys.pubkey_a));
  expect(valid).toBe(true);
});
