import { test, expect, describe } from "bun:test";
import { createPreimageStore } from "./preimage-store";

describe("PreimageStore", () => {
  test("create generates hash/preimage pair", () => {
    const store = createPreimageStore();
    const entry = store.create();

    expect(entry.hash).toHaveLength(64); // SHA-256 hex
    expect(entry.preimage).toHaveLength(64);
    expect(entry.created_at).toBeGreaterThan(0);
  });

  test("has returns true for known hash", () => {
    const store = createPreimageStore();
    const entry = store.create();

    expect(store.has(entry.hash)).toBe(true);
    expect(store.has("unknown")).toBe(false);
  });

  test("getPreimage returns preimage for known hash", () => {
    const store = createPreimageStore();
    const entry = store.create();

    expect(store.getPreimage(entry.hash)).toBe(entry.preimage);
    expect(store.getPreimage("unknown")).toBe(null);
  });

  test("verify validates preimage against stored hash", () => {
    const store = createPreimageStore();
    const entry = store.create();

    expect(store.verify(entry.hash, entry.preimage)).toBe(true);
    expect(store.verify(entry.hash, "0000000000000000000000000000000000000000000000000000000000000000")).toBe(false);
    expect(store.verify("unknown", entry.preimage)).toBe(false);
  });

  test("delete removes entry", () => {
    const store = createPreimageStore();
    const entry = store.create();

    expect(store.has(entry.hash)).toBe(true);
    store.delete(entry.hash);
    expect(store.has(entry.hash)).toBe(false);
    expect(store.getPreimage(entry.hash)).toBe(null);
  });

  test("create generates unique pairs", () => {
    const store = createPreimageStore();
    const e1 = store.create();
    const e2 = store.create();

    expect(e1.hash).not.toBe(e2.hash);
    expect(e1.preimage).not.toBe(e2.preimage);
  });
});
