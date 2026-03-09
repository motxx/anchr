/**
 * In-memory store for attachment integrity metadata.
 *
 * Populated at upload time (before EXIF strip), queried at verification time.
 * Keyed by attachment ID (filename), so the verifier can look up metadata
 * even though the client-supplied attachment refs are untrusted.
 */

import type { C2paValidationResult } from "./c2pa-validation";
import type { ExifValidationResult } from "./exif-validation";

export interface IntegrityMetadata {
  attachmentId: string;
  queryId: string;
  capturedAt: number;
  exif: ExifValidationResult;
  c2pa: C2paValidationResult;
}

const store = new Map<string, IntegrityMetadata>();

export function storeIntegrity(metadata: IntegrityMetadata): void {
  store.set(metadata.attachmentId, metadata);
}

export function getIntegrity(attachmentId: string): IntegrityMetadata | null {
  return store.get(attachmentId) ?? null;
}

export function getIntegrityForQuery(queryId: string): IntegrityMetadata[] {
  return [...store.values()].filter((m) => m.queryId === queryId);
}

/** Remove integrity data older than maxAgeMs (default: 2 hours). */
export function purgeStaleIntegrity(maxAgeMs = 7_200_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let count = 0;
  for (const [key, value] of store) {
    if (value.capturedAt < cutoff) {
      store.delete(key);
      count++;
    }
  }
  return count;
}

/** Clear all entries (for testing). */
export function clearIntegrityStore(): void {
  store.clear();
}
