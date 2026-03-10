/**
 * Data purge: completely delete expired query data (attachment files + memory).
 *
 * Privacy guarantee: once a query expires, all traces are removed.
 */

import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_UPLOADS_DIR } from "./config";
import { purgeExpiredFromStore } from "./query-service";
import type { AttachmentRef, QueryResult } from "./types";

function extractFilePaths(result: QueryResult | null | undefined): string[] {
  if (!result || result.type !== "photo_proof") return [];
  const paths: string[] = [];
  for (const a of result.attachments) {
    if (a.local_file_path) paths.push(a.local_file_path);
    else if (a.filename) paths.push(join(DEFAULT_UPLOADS_DIR, a.filename));
  }
  return paths;
}

/**
 * Purge all expired queries: delete attachment files and remove from store.
 * Returns number of queries purged.
 */
export async function purgeExpiredQueries(): Promise<number> {
  const expired = purgeExpiredFromStore();
  if (expired.length === 0) return 0;

  const filesToDelete = expired.flatMap((q) => extractFilePaths(q.result));
  await Promise.allSettled(filesToDelete.map((path) => unlink(path).catch(() => {})));

  return expired.length;
}
