/**
 * Shared submission and evidence value objects used across the request
 * lifecycle, proof verification, and attachment transport.
 *
 * This module is a leaf: it imports nothing from feature directories
 * (`requests/`, `proofs/`, `attachments/`, `adapters/`), so both the request
 * lifecycle and the proof verifier can depend on it in one direction without a
 * type cycle.
 */

export type AttachmentStorageKind = "blossom" | "external";

/** Verification labels are schema-internal strings carried opaquely. */
export const VERIFICATION_FACTORS = [] as const;
export type VerificationFactor = string;

export const DEFAULT_VERIFICATION_FACTORS: readonly VerificationFactor[] = [];

export interface AttachmentRef {
  id: string;
  uri: string;
  mime_type: string;
  storage_kind: AttachmentStorageKind;
  filename?: string;
  size_bytes?: number;
  /** Blossom-specific: SHA-256 hash of encrypted blob. */
  blossom_hash?: string;
  /** Blossom-specific: server URLs where the blob is stored. */
  blossom_servers?: string[];
}

/** Ephemeral key material for Blossom E2E encryption. Never persisted on the server. */
export interface BlossomKeyMaterial {
  encrypt_key: string; // hex-encoded AES-256-GCM key
  encrypt_iv: string; // hex-encoded AES-256-GCM IV
}

/** Map of attachment ID → key material, used for one-time oracle verification. */
export type BlossomKeyMap = Record<string, BlossomKeyMaterial>;
