import { afterEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createPersistentPreimageStore,
  createPreimageStore,
} from "@anchr/sdk/payments";
import { createFileSystemPersistenceStore } from "../../adapters/storage.ts";

describe("PreimageStore", () => {
  test("create generates hash/preimage pair", async () => {
    const store = createPreimageStore();
    const entry = await store.create();

    expect(entry.hash).toHaveLength(64); // SHA-256 hex
    expect(entry.preimage).toHaveLength(64);
    expect(entry.created_at).toBeGreaterThan(0);
  });

  test("has returns true for known hash", async () => {
    const store = createPreimageStore();
    const entry = await store.create();

    expect(await store.has(entry.hash)).toBe(true);
    expect(await store.has("unknown")).toBe(false);
  });

  test("getPreimage returns preimage for known hash", async () => {
    const store = createPreimageStore();
    const entry = await store.create();

    expect(await store.getPreimage(entry.hash)).toBe(entry.preimage);
    expect(await store.getPreimage("unknown")).toBe(null);
  });

  test("verify validates preimage against stored hash", async () => {
    const store = createPreimageStore();
    const entry = await store.create();

    expect(await store.verify(entry.hash, entry.preimage)).toBe(true);
    expect(
      await store.verify(
        entry.hash,
        "0000000000000000000000000000000000000000000000000000000000000000",
      ),
    ).toBe(false);
    expect(await store.verify("unknown", entry.preimage)).toBe(false);
  });

  test("delete removes entry", async () => {
    const store = createPreimageStore();
    const entry = await store.create();

    expect(await store.has(entry.hash)).toBe(true);
    await store.delete(entry.hash);
    expect(await store.has(entry.hash)).toBe(false);
    expect(await store.getPreimage(entry.hash)).toBe(null);
  });

  test("create generates unique pairs", async () => {
    const store = createPreimageStore();
    const e1 = await store.create();
    const e2 = await store.create();

    expect(e1.hash).not.toBe(e2.hash);
    expect(e1.preimage).not.toBe(e2.preimage);
  });
});

describe("PersistentPreimageStore", () => {
  const tmpFiles: string[] = [];

  function tmpPath(): string {
    const p = Deno.makeTempFileSync({ suffix: ".json" });
    try {
      Deno.removeSync(p);
    } catch { /* ignore */ }
    tmpFiles.push(p);
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

  test("create generates hash/preimage pair and persists to file", async () => {
    const filePath = tmpPath();
    const store = await createPersistentPreimageStore(filePath);
    const entry = await store.create();

    expect(entry.hash).toHaveLength(64);
    expect(entry.preimage).toHaveLength(64);
    expect(entry.created_at).toBeGreaterThan(0);

    const data = JSON.parse(
      await createFileSystemPersistenceStore().readText(filePath),
    );
    expect(data.entries[entry.hash]).toBeDefined();
    expect(data.entries[entry.hash].preimage).toBe(entry.preimage);
  });

  test("has returns true for known hash", async () => {
    const filePath = tmpPath();
    const store = await createPersistentPreimageStore(filePath);
    const entry = await store.create();

    expect(await store.has(entry.hash)).toBe(true);
    expect(await store.has("unknown")).toBe(false);
  });

  test("getPreimage returns preimage for known hash", async () => {
    const filePath = tmpPath();
    const store = await createPersistentPreimageStore(filePath);
    const entry = await store.create();

    expect(await store.getPreimage(entry.hash)).toBe(entry.preimage);
    expect(await store.getPreimage("unknown")).toBe(null);
  });

  test("verify validates preimage against stored hash", async () => {
    const filePath = tmpPath();
    const store = await createPersistentPreimageStore(filePath);
    const entry = await store.create();

    expect(await store.verify(entry.hash, entry.preimage)).toBe(true);
    expect(
      await store.verify(
        entry.hash,
        "0000000000000000000000000000000000000000000000000000000000000000",
      ),
    ).toBe(false);
    expect(await store.verify("unknown", entry.preimage)).toBe(false);
  });

  test("delete removes entry and updates file", async () => {
    const filePath = tmpPath();
    const store = await createPersistentPreimageStore(filePath);
    const entry = await store.create();

    expect(await store.has(entry.hash)).toBe(true);
    await store.delete(entry.hash);
    expect(await store.has(entry.hash)).toBe(false);
    expect(await store.getPreimage(entry.hash)).toBe(null);

    const data = JSON.parse(
      await createFileSystemPersistenceStore().readText(filePath),
    );
    expect(data.entries[entry.hash]).toBeUndefined();
  });

  test("survives process restart by reading from file", async () => {
    const filePath = tmpPath();

    const store1 = await createPersistentPreimageStore(filePath);
    const e1 = await store1.create();
    const e2 = await store1.create();

    const store2 = await createPersistentPreimageStore(filePath);

    expect(await store2.has(e1.hash)).toBe(true);
    expect(await store2.has(e2.hash)).toBe(true);
    expect(await store2.getPreimage(e1.hash)).toBe(e1.preimage);
    expect(await store2.getPreimage(e2.hash)).toBe(e2.preimage);
  });

  test("starts empty when file does not exist", async () => {
    const filePath = tmpPath();
    const store = await createPersistentPreimageStore(filePath);

    expect(await store.has("anything")).toBe(false);
    expect(await store.getPreimage("anything")).toBe(null);
  });

  test("delete on reloaded store persists correctly", async () => {
    const filePath = tmpPath();

    const store1 = await createPersistentPreimageStore(filePath);
    const e1 = await store1.create();
    const e2 = await store1.create();

    const store2 = await createPersistentPreimageStore(filePath);
    await store2.delete(e1.hash);

    const store3 = await createPersistentPreimageStore(filePath);
    expect(await store3.has(e1.hash)).toBe(false);
    expect(await store3.has(e2.hash)).toBe(true);
    expect(await store3.getPreimage(e2.hash)).toBe(e2.preimage);
  });

  test("create generates unique pairs", async () => {
    const filePath = tmpPath();
    const store = await createPersistentPreimageStore(filePath);
    const e1 = await store.create();
    const e2 = await store.create();

    expect(e1.hash).not.toBe(e2.hash);
    expect(e1.preimage).not.toBe(e2.preimage);
  });
});
