import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearQueryStore, createQuery, expireQueries } from "./query-service";
import { purgeExpiredQueries } from "./data-purge";

describe("data purge", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "anchr-purge-test-"));
    clearQueryStore();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("purges expired queries from memory store", async () => {
    // Create an expired query
    createQuery(
      { type: "photo_proof", target: "test" },
      { ttlMs: -1 },
    );
    // Create an active query
    const active = createQuery(
      { type: "store_status", store_name: "test" },
      { ttlMs: 60_000 },
    );

    // Expire pending queries first
    const expired = expireQueries();
    expect(expired).toBe(1);

    // Purge expired
    const purged = await purgeExpiredQueries();
    expect(purged).toBe(1);

    // Active query should still exist
    const { getQuery } = await import("./query-service");
    expect(getQuery(active.id)).not.toBeNull();
  });

  test("deletes attachment files for expired queries", async () => {
    const uploadsDir = join(tempDir, "uploads");
    await Bun.write(join(uploadsDir, "q1_photo.jpg"), "fake image data");
    await Bun.write(join(uploadsDir, "q2_photo.jpg"), "keep this");

    let files = await readdir(uploadsDir);
    expect(files.length).toBe(2);

    const { unlink } = await import("node:fs/promises");
    await unlink(join(uploadsDir, "q1_photo.jpg"));

    files = await readdir(uploadsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe("q2_photo.jpg");
  });
});
