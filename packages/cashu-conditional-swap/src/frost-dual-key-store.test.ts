import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createAdaptiveReleaseAuthority,
  createFrostReleaseAuthority,
  createSingleKeyReleaseAuthority,
} from "./frost-dual-key-store.ts";
import { createDualKeyStore } from "./frost-conditional-swap.ts";
import { _setFrostSignerPathForTest } from "@anchr/frost-oracle/frost-cli";

const originalPath = null;

test("createAdaptiveReleaseAuthority uses single-key when no config", () => {
  const { authority, mode } = createAdaptiveReleaseAuthority(undefined);
  expect(mode).toBe("single-key");
  expect(authority).toBeTruthy();
});

test("createAdaptiveReleaseAuthority uses single-key when frost-signer unavailable", () => {
  _setFrostSignerPathForTest(null);
  try {
    const mockConfig = {
      signer_index: 1,
      total_signers: 3,
      threshold: 2,
      key_package: {},
      pubkey_package: {},
      group_pubkey: "aa".repeat(32),
      peers: [],
      key_package_b: {},
      pubkey_package_b: {},
      group_pubkey_b: "bb".repeat(32),
    };

    const { authority, mode } = createAdaptiveReleaseAuthority(mockConfig);
    expect(mode).toBe("single-key");

    const entry = authority.create("test-swap");
    expect(entry.pubkey_a).toBeTruthy();
    expect(entry.pubkey_b).toBeTruthy();
    expect(entry.pubkey_a.length).toBe(64);
    expect(entry.pubkey_b.length).toBe(64);
  } finally {
    _setFrostSignerPathForTest(null);
  }
});

test("single-key release authority create + sign lifecycle", async () => {
  const authority = createSingleKeyReleaseAuthority();
  const entry = authority.create("swap-1");

  expect(entry.swap_id).toBe("swap-1");
  expect(entry.pubkey_a).toBeTruthy();
  expect(entry.pubkey_b).toBeTruthy();
  expect(entry.signed).toBe(false);

  const msg = new TextEncoder().encode("swap-1:yes");
  const sig = await authority.releaseSignature({
    swap_id: "swap-1",
    outcome: "a",
    message: msg,
  });
  expect(sig).toBeTruthy();
  expect(sig!.length).toBe(128);

  const sig2 = await authority.releaseSignature({
    swap_id: "swap-1",
    outcome: "b",
    message: msg,
  });
  expect(sig2).toBeNull();
});

test("single-key release authority rejects empty proof-secret signing requests", async () => {
  const authority = createSingleKeyReleaseAuthority();
  authority.create("swap-1");

  const signatures = await authority.releaseProofSecretSignatures({
    swap_id: "swap-1",
    outcome: "a",
    proofSecrets: [],
  });

  expect(signatures).toBeNull();
});

test("createFrostReleaseAuthority exposes FROST group pubkeys without synchronous signing", () => {
  const authority = createFrostReleaseAuthority({
    nodeConfig: {
      signer_index: 1,
      total_signers: 3,
      threshold: 2,
      key_package: {},
      pubkey_package: {},
      group_pubkey: "aa".repeat(32),
      peers: [],
      key_package_b: {},
      pubkey_package_b: {},
      group_pubkey_b: "bb".repeat(32),
    },
  });

  const entry = authority.create("test-swap");
  expect(entry.pubkey_a).toBe("aa".repeat(32));
  expect(entry.pubkey_b).toBe("bb".repeat(32));
});

test("DualKeyStore getPubkeys returns null for unknown swap", () => {
  const store = createDualKeyStore();
  expect(store.getPubkeys("nonexistent")).toBeNull();
});

test("DualKeyStore has returns false for unknown swap", () => {
  const store = createDualKeyStore();
  expect(store.has("nonexistent")).toBe(false);
});

test("DualKeyStore create is idempotent", () => {
  const store = createDualKeyStore();
  const entry1 = store.create("swap-1");
  const entry2 = store.create("swap-1");
  expect(entry1.pubkey_a).toBe(entry2.pubkey_a);
  expect(entry1.pubkey_b).toBe(entry2.pubkey_b);
});
