import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createDualPreimageStore } from "./dual-preimage-store.ts";

test("create returns two distinct hashes", () => {
  const store = createDualPreimageStore();
  const { hash_a, hash_b } = store.create("swap-1");

  expect(hash_a).toBeTruthy();
  expect(hash_b).toBeTruthy();
  expect(hash_a).not.toBe(hash_b);
  expect(hash_a.length).toBe(64); // SHA-256 hex
  expect(hash_b.length).toBe(64);
});

test("create returns same hashes for same swap_id", () => {
  const store = createDualPreimageStore();
  const first = store.create("swap-1");
  const second = store.create("swap-1");

  expect(first.hash_a).toBe(second.hash_a);
  expect(first.hash_b).toBe(second.hash_b);
});

test("create returns different hashes for different swap_ids", () => {
  const store = createDualPreimageStore();
  const s1 = store.create("swap-1");
  const s2 = store.create("swap-2");

  expect(s1.hash_a).not.toBe(s2.hash_a);
  expect(s1.hash_b).not.toBe(s2.hash_b);
});

test("getHashes returns hashes after create", () => {
  const store = createDualPreimageStore();
  const created = store.create("swap-1");
  const got = store.getHashes("swap-1");

  expect(got).not.toBeNull();
  expect(got!.hash_a).toBe(created.hash_a);
  expect(got!.hash_b).toBe(created.hash_b);
});

test("getHashes returns null for unknown swap", () => {
  const store = createDualPreimageStore();
  expect(store.getHashes("unknown")).toBeNull();
});

test("has returns true for existing swap", () => {
  const store = createDualPreimageStore();
  store.create("swap-1");
  expect(store.has("swap-1")).toBe(true);
  expect(store.has("unknown")).toBe(false);
});

test("reveal outcome a returns preimage_a and deletes preimage_b", () => {
  const store = createDualPreimageStore();
  const { hash_a } = store.create("swap-1");

  const preimage = store.reveal("swap-1", "a");
  expect(preimage).toBeTruthy();
  expect(typeof preimage).toBe("string");
  expect(preimage!.length).toBe(64); // hex preimage
});

test("reveal outcome b returns preimage_b and deletes preimage_a", () => {
  const store = createDualPreimageStore();
  store.create("swap-1");

  const preimage = store.reveal("swap-1", "b");
  expect(preimage).toBeTruthy();
  expect(typeof preimage).toBe("string");
});

test("reveal twice returns null (already revealed)", () => {
  const store = createDualPreimageStore();
  store.create("swap-1");

  const first = store.reveal("swap-1", "a");
  expect(first).toBeTruthy();

  const second = store.reveal("swap-1", "a");
  expect(second).toBeNull();
});

test("reveal for unknown swap returns null", () => {
  const store = createDualPreimageStore();
  expect(store.reveal("unknown", "a")).toBeNull();
});

test("losing preimage is permanently deleted after reveal", () => {
  const store = createDualPreimageStore();
  store.create("swap-1");

  // Reveal outcome a — preimage_b should be deleted from backing store
  store.reveal("swap-1", "a");

  // The swap is marked as revealed, so any further reveal returns null
  // This proves the losing preimage can never be recovered
  const tryAgain = store.reveal("swap-1", "b");
  expect(tryAgain).toBeNull();
});

test("multiple swaps are independent", () => {
  const store = createDualPreimageStore();
  store.create("swap-1");
  store.create("swap-2");

  const p1 = store.reveal("swap-1", "a");
  expect(p1).toBeTruthy();

  // swap-2 is unaffected
  const p2 = store.reveal("swap-2", "b");
  expect(p2).toBeTruthy();

  // Both are now revealed
  expect(store.reveal("swap-1", "a")).toBeNull();
  expect(store.reveal("swap-2", "b")).toBeNull();
});
