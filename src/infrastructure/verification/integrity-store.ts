/**
 * In-memory store for attachment integrity metadata.
 *
 * Populated at upload time (before EXIF strip), queried at verification time.
 * Keyed by attachment ID (filename), so the verifier can look up metadata
 * even though the client-supplied attachment refs are untrusted.
 */

import type { C2paValidationResult } from "./c2pa-validation";
import type { ExifValidationResult } from "./exif-validation";
import type { ProofModeMetadata } from "./proofmode-validation";

export interface ProofModeIntegrity {
  /** Parsed proof.json metadata. */
  proof: ProofModeMetadata | null;
  /** SHA256 hash in proof.json matches actual photo hash. */
  hashValid: boolean;
  /** PGP signature verification result (null = gpg not available). */
  pgpValid: boolean | null;
  /** OpenTimestamps proof present. */
  hasOts: boolean;
  /** Apple DeviceCheck attestation present. */
  hasDeviceCheck: boolean;
  /** Advisory checks. */
  checks: string[];
  /** Failures. */
  failures: string[];
}

export interface IntegrityMetadata {
  attachmentId: string;
  queryId: string;
  capturedAt: number;
  exif: ExifValidationResult;
  c2pa: C2paValidationResult;
  proofmode?: ProofModeIntegrity;
}

export interface IntegrityStore {
  store(metadata: IntegrityMetadata): void;
  get(attachmentId: string): IntegrityMetadata | null;
  getForQuery(queryId: string): IntegrityMetadata[];
  purgeStale(maxAgeMs?: number): number;
  clear(): void;
}

export function createIntegrityStore(): IntegrityStore {
  const map = new Map<string, IntegrityMetadata>();

  return {
    store(metadata) {
      map.set(metadata.attachmentId, metadata);
    },
    get(attachmentId) {
      return map.get(attachmentId) ?? null;
    },
    getForQuery(queryId) {
      return [...map.values()].filter((m) => m.queryId === queryId);
    },
    purgeStale(maxAgeMs = 7_200_000) {
      const cutoff = Date.now() - maxAgeMs;
      let count = 0;
      for (const [key, value] of map) {
        if (value.capturedAt < cutoff) {
          map.delete(key);
          count++;
        }
      }
      return count;
    },
    clear() {
      map.clear();
    },
  };
}

// --- Default singleton (backward compat) ---

const defaultStore = createIntegrityStore();

export function storeIntegrity(metadata: IntegrityMetadata): void {
  defaultStore.store(metadata);
}

export function getIntegrity(attachmentId: string): IntegrityMetadata | null {
  return defaultStore.get(attachmentId);
}

export function getIntegrityForQuery(queryId: string): IntegrityMetadata[] {
  return defaultStore.getForQuery(queryId);
}

export function purgeStaleIntegrity(maxAgeMs = 7_200_000): number {
  return defaultStore.purgeStale(maxAgeMs);
}

export function clearIntegrityStore(): void {
  defaultStore.clear();
}
