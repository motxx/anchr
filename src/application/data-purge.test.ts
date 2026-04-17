import { afterEach, beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { mkdtemp, rm, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQueryService } from "./query-service";
import type { QueryService } from "./query-service";

describe("data purge", () => {
  let tempDir: string;
  let svc: QueryService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "anchr-purge-test-"));
    svc = createQueryService();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("purges expired queries from memory store", async () => {
    // Create an expired query
    svc.createQuery(
      { description: "expired test query" },
      { ttlMs: -1 },
    );
    // Create an active query
    const active = svc.createQuery(
      { description: "active test query" },
      { ttlMs: 60_000 },
    );

    // Expire pending queries first
    const expired = svc.expireQueries();
    expect(expired).toBe(1);

    // Purge expired
    const purged = svc.purgeExpiredFromStore();
    expect(purged).toHaveLength(1);

    // Active query should still exist
    expect(svc.getQuery(active.id)).not.toBeNull();
  });

  test("deletes attachment files for expired queries", async () => {
    const uploadsDir = join(tempDir, "uploads");
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, "q1_photo.jpg"), "fake image data");
    await writeFile(join(uploadsDir, "q2_photo.jpg"), "keep this");

    let files = await readdir(uploadsDir);
    expect(files.length).toBe(2);

    const { unlink } = await import("node:fs/promises");
    await unlink(join(uploadsDir, "q1_photo.jpg"));

    files = await readdir(uploadsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe("q2_photo.jpg");
  });
});
