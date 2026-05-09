import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createAdaptiveDualKeyStore,
  createFrostDualKeyStore,
} from "./frost-dual-key-store.ts";
import { createDualKeyStore } from "./frost-conditional-swap.ts";
import { _setFrostSignerPathForTest } from "@anchr/frost-oracle/frost-cli";

const originalPath = null;

test("createAdaptiveDualKeyStore falls back to single-key when no config", () => {
  const { store, mode } = createAdaptiveDualKeyStore(undefined);
  expect(mode).toBe("single-key");
  expect(store).toBeTruthy();
});

test("createAdaptiveDualKeyStore falls back to single-key when frost-signer unavailable", () => {
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

    const { store, mode } = createAdaptiveDualKeyStore(mockConfig);
    expect(mode).toBe("single-key");

    const entry = store.create("test-swap");
    expect(entry.pubkey_a).toBeTruthy();
    expect(entry.pubkey_b).toBeTruthy();
    expect(entry.pubkey_a.length).toBe(64);
    expect(entry.pubkey_b.length).toBe(64);
  } finally {
    _setFrostSignerPathForTest(null);
  }
});

test("single-key DualKeyStore create + sign lifecycle", () => {
  const store = createDualKeyStore();
  const entry = store.create("swap-1");

  expect(entry.swap_id).toBe("swap-1");
  expect(entry.pubkey_a).toBeTruthy();
  expect(entry.pubkey_b).toBeTruthy();
  expect(entry.signed).toBe(false);

  const msg = new TextEncoder().encode("swap-1:yes");
  const sig = store.sign("swap-1", "a", msg);
  expect(sig).toBeTruthy();
  expect(sig!.length).toBe(128);

  const sig2 = store.sign("swap-1", "b", msg);
  expect(sig2).toBeNull();
});

test("createFrostDualKeyStore falls back when frost-signer unavailable", () => {
  _setFrostSignerPathForTest(null);
  try {
    const store = createFrostDualKeyStore({
      yesConfig: {
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

    const entry = store.create("test-swap");
    expect(entry.pubkey_a).toBeTruthy();
    expect(entry.pubkey_b).toBeTruthy();
  } finally {
    _setFrostSignerPathForTest(null);
  }
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
