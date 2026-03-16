import { test, expect, describe } from "bun:test";
import { createPreimageStore } from "./preimage-store";

describe("PreimageStore", () => {
  test("create generates hash/preimage pair", () => {
    const store = createPreimageStore();
    const entry = store.create("query_1");

    expect(entry.hash).toHaveLength(64); // SHA-256 hex
    expect(entry.preimage).toHaveLength(64);
    expect(entry.query_id).toBe("query_1");
    expect(entry.created_at).toBeGreaterThan(0);
  });

  test("getHash returns hash for known query", () => {
    const store = createPreimageStore();
    const entry = store.create("query_2");

    expect(store.getHash("query_2")).toBe(entry.hash);
    expect(store.getHash("unknown")).toBe(null);
  });

  test("getPreimage returns preimage for known query", () => {
    const store = createPreimageStore();
    const entry = store.create("query_3");

    expect(store.getPreimage("query_3")).toBe(entry.preimage);
    expect(store.getPreimage("unknown")).toBe(null);
  });

  test("verify validates preimage against stored hash", () => {
    const store = createPreimageStore();
    const entry = store.create("query_4");

    expect(store.verify("query_4", entry.preimage)).toBe(true);
    expect(store.verify("query_4", "0000000000000000000000000000000000000000000000000000000000000000")).toBe(false);
    expect(store.verify("unknown", entry.preimage)).toBe(false);
  });

  test("delete removes entry", () => {
    const store = createPreimageStore();
    store.create("query_5");

    expect(store.getHash("query_5")).not.toBe(null);
    store.delete("query_5");
    expect(store.getHash("query_5")).toBe(null);
    expect(store.getPreimage("query_5")).toBe(null);
  });

  test("create generates unique pairs", () => {
    const store = createPreimageStore();
    const e1 = store.create("query_a");
    const e2 = store.create("query_b");

    expect(e1.hash).not.toBe(e2.hash);
    expect(e1.preimage).not.toBe(e2.preimage);
  });
});
