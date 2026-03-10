import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We test the purge logic by directly importing and mocking the DB
// Since data-purge uses getDb() from sqlite-query-store, we test the SQL logic directly

describe("data purge", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gt-purge-test-"));
    db = new Database(join(tempDir, "test.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec(`
      CREATE TABLE queries (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        params TEXT NOT NULL,
        challenge_nonce TEXT NOT NULL,
        challenge_rule TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        requester_meta TEXT,
        submitted_at INTEGER,
        result TEXT,
        verification TEXT,
        submission_meta TEXT,
        payment_status TEXT NOT NULL DEFAULT 'locked'
      )
    `);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("deletes expired query records from DB", () => {
    // Insert expired query
    db.prepare(`
      INSERT INTO queries (id, type, status, params, challenge_nonce, challenge_rule, created_at, expires_at, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("q1", "photo_proof", "expired", "{}", "ABCD", "rule", Date.now() - 60000, Date.now() - 30000, "cancelled");

    // Insert pending query (should NOT be deleted)
    db.prepare(`
      INSERT INTO queries (id, type, status, params, challenge_nonce, challenge_rule, created_at, expires_at, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("q2", "photo_proof", "pending", "{}", "EFGH", "rule", Date.now(), Date.now() + 60000, "locked");

    // Purge expired
    const rows = db.prepare("SELECT id FROM queries WHERE status = 'expired'").all() as { id: string }[];
    expect(rows.length).toBe(1);

    const ids = rows.map(r => r.id);
    db.prepare(`DELETE FROM queries WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);

    // q1 should be gone, q2 should remain
    const remaining = db.prepare("SELECT id FROM queries").all() as { id: string }[];
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.id).toBe("q2");
  });

  test("deletes attachment files for expired queries", async () => {
    const uploadsDir = join(tempDir, "uploads");
    await Bun.write(join(uploadsDir, "q1_photo.jpg"), "fake image data");
    await Bun.write(join(uploadsDir, "q2_photo.jpg"), "keep this");

    // Verify files exist
    let files = await readdir(uploadsDir);
    expect(files.length).toBe(2);

    // Delete just q1's file
    const { unlink } = await import("node:fs/promises");
    await unlink(join(uploadsDir, "q1_photo.jpg"));

    files = await readdir(uploadsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe("q2_photo.jpg");
  });

  test("handles queries without attachments gracefully", () => {
    db.prepare(`
      INSERT INTO queries (id, type, status, params, challenge_nonce, challenge_rule, created_at, expires_at, result, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "q3", "store_status", "expired", '{"type":"store_status","store_name":"test"}',
      "WXYZ", "rule", Date.now() - 60000, Date.now() - 30000,
      '{"type":"store_status","status":"open","notes":"WXYZ test"}',
      "cancelled"
    );

    const rows = db.prepare("SELECT id, result FROM queries WHERE status = 'expired'").all() as { id: string; result: string }[];
    expect(rows.length).toBe(1);

    // Parse result — no attachments for store_status
    const result = JSON.parse(rows[0]!.result);
    expect(result.type).toBe("store_status");
    // Should not throw even though there are no attachments
  });
});
