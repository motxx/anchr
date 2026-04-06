import { describe, test, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createPreimageStore, createPersistentPreimageStore } from "./preimage-store";

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

describe("PersistentPreimageStore", () => {
  const tmpFiles: string[] = [];

  function tmpPath(): string {
    const p = Deno.makeTempFileSync({ suffix: ".json" });
    // Remove the file so the store starts fresh (tests that need pre-existing data will write it)
    try {
      Deno.removeSync(p);
    } catch { /* ignore */ }
    tmpFiles.push(p);
    // Also track the .tmp sibling for cleanup
    tmpFiles.push(p + ".tmp");
    return p;
  }

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        Deno.removeSync(f);
      } catch { /* ignore */ }
    }
    tmpFiles.length = 0;
  });

  test("create generates hash/preimage pair and persists to file", () => {
    const filePath = tmpPath();
    const store = createPersistentPreimageStore(filePath);
    const entry = store.create();

    expect(entry.hash).toHaveLength(64);
    expect(entry.preimage).toHaveLength(64);
    expect(entry.created_at).toBeGreaterThan(0);

    // File should exist with the entry
    const data = JSON.parse(Deno.readTextFileSync(filePath));
    expect(data.entries[entry.hash]).toBeDefined();
    expect(data.entries[entry.hash].preimage).toBe(entry.preimage);
  });

  test("has returns true for known hash", () => {
    const filePath = tmpPath();
    const store = createPersistentPreimageStore(filePath);
    const entry = store.create();

    expect(store.has(entry.hash)).toBe(true);
    expect(store.has("unknown")).toBe(false);
  });

  test("getPreimage returns preimage for known hash", () => {
    const filePath = tmpPath();
    const store = createPersistentPreimageStore(filePath);
    const entry = store.create();

    expect(store.getPreimage(entry.hash)).toBe(entry.preimage);
    expect(store.getPreimage("unknown")).toBe(null);
  });

  test("verify validates preimage against stored hash", () => {
    const filePath = tmpPath();
    const store = createPersistentPreimageStore(filePath);
    const entry = store.create();

    expect(store.verify(entry.hash, entry.preimage)).toBe(true);
    expect(store.verify(entry.hash, "0000000000000000000000000000000000000000000000000000000000000000")).toBe(false);
    expect(store.verify("unknown", entry.preimage)).toBe(false);
  });

  test("delete removes entry and updates file", () => {
    const filePath = tmpPath();
    const store = createPersistentPreimageStore(filePath);
    const entry = store.create();

    expect(store.has(entry.hash)).toBe(true);
    store.delete(entry.hash);
    expect(store.has(entry.hash)).toBe(false);
    expect(store.getPreimage(entry.hash)).toBe(null);

    // File should reflect deletion
    const data = JSON.parse(Deno.readTextFileSync(filePath));
    expect(data.entries[entry.hash]).toBeUndefined();
  });

  test("survives process restart by reading from file", () => {
    const filePath = tmpPath();

    // Simulate first run: create entries
    const store1 = createPersistentPreimageStore(filePath);
    const e1 = store1.create();
    const e2 = store1.create();

    // Simulate restart: create a new store instance from same file
    const store2 = createPersistentPreimageStore(filePath);

    expect(store2.has(e1.hash)).toBe(true);
    expect(store2.has(e2.hash)).toBe(true);
    expect(store2.getPreimage(e1.hash)).toBe(e1.preimage);
    expect(store2.getPreimage(e2.hash)).toBe(e2.preimage);
  });

  test("starts empty when file does not exist", () => {
    const filePath = tmpPath();
    const store = createPersistentPreimageStore(filePath);

    expect(store.has("anything")).toBe(false);
    expect(store.getPreimage("anything")).toBe(null);
  });

  test("delete on reloaded store persists correctly", () => {
    const filePath = tmpPath();

    const store1 = createPersistentPreimageStore(filePath);
    const e1 = store1.create();
    const e2 = store1.create();

    // Reload and delete one entry
    const store2 = createPersistentPreimageStore(filePath);
    store2.delete(e1.hash);

    // Reload again and verify
    const store3 = createPersistentPreimageStore(filePath);
    expect(store3.has(e1.hash)).toBe(false);
    expect(store3.has(e2.hash)).toBe(true);
    expect(store3.getPreimage(e2.hash)).toBe(e2.preimage);
  });

  test("create generates unique pairs", () => {
    const filePath = tmpPath();
    const store = createPersistentPreimageStore(filePath);
    const e1 = store.create();
    const e2 = store.create();

    expect(e1.hash).not.toBe(e2.hash);
    expect(e1.preimage).not.toBe(e2.preimage);
  });
});
