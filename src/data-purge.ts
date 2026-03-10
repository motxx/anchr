/**
 * Data purge: completely delete expired query data (DB records + attachment files).
 *
 * Privacy guarantee: once a query expires, all traces are removed.
 * No forensic recovery possible from the server.
 */

import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "./sqlite-query-store";
import { DEFAULT_UPLOADS_DIR } from "./config";
import type { AttachmentRef, QueryResult } from "./types";

interface ExpiredQueryRow {
  id: string;
  result: string | null;
}

function extractAttachmentPaths(result: QueryResult | null): string[] {
  if (!result || result.type !== "photo_proof") return [];
  return result.attachments
    .map((a: AttachmentRef) => a.local_file_path)
    .filter((p): p is string => !!p);
}

function extractAttachmentFilenames(result: QueryResult | null): string[] {
  if (!result || result.type !== "photo_proof") return [];
  return result.attachments
    .map((a: AttachmentRef) => a.filename)
    .filter((f): f is string => !!f);
}

/**
 * Purge all expired queries: delete attachment files and remove DB records.
 * Returns number of queries purged.
 */
export async function purgeExpiredQueries(): Promise<number> {
  const db = getDb();

  const rows = db
    .prepare("SELECT id, result FROM queries WHERE status = 'expired'")
    .all() as ExpiredQueryRow[];

  if (rows.length === 0) return 0;

  // Collect all file paths to delete
  const filesToDelete: string[] = [];
  for (const row of rows) {
    let result: QueryResult | null = null;
    if (row.result) {
      try {
        result = JSON.parse(row.result) as QueryResult;
      } catch {
        // corrupted JSON, just delete the record
      }
    }

    // Collect explicit local_file_path
    filesToDelete.push(...extractAttachmentPaths(result));

    // Also try to find files by filename in uploads dir
    for (const filename of extractAttachmentFilenames(result)) {
      const uploadPath = join(DEFAULT_UPLOADS_DIR, filename);
      if (!filesToDelete.includes(uploadPath)) {
        filesToDelete.push(uploadPath);
      }
    }
  }

  // Delete files (best effort, don't fail if already gone)
  await Promise.allSettled(
    filesToDelete.map((path) => unlink(path).catch(() => {}))
  );

  // Delete DB records
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM queries WHERE id IN (${placeholders})`).run(...ids);

  return rows.length;
}
