import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createDualPreimageStore } from "../../../src/infrastructure/conditional-swap/dual-preimage-store.ts";
import { resolveMarket } from "./resolution.ts";

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
