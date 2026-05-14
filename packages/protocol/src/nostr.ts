/**
 * Nostr helper layer for the SDK.
 *
 * Type-safe wrappers around nostr-tools for protocol-level operations:
 * NIP-44 v2 encryption, ephemeral identity, tag/key helpers, and Anchr's
 * NIP-90 kind constants (5300 / 6300 / 7000).
 */

import {
  type Event,
  type EventTemplate,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type UnsignedEvent,
} from "nostr-tools/pure";
import {
  decrypt as nip44Decrypt,
  encrypt as nip44Encrypt,
  getConversationKey,
} from "nostr-tools/nip44";
import { decode as nip19Decode } from "nostr-tools/nip19";
import type { AdapterManifest } from "./capabilities.ts";

/** Anchr Job Request (NIP-90 standard kind 5300). */
export const KIND_QUERY_REQUEST = 5300;
/** Anchr Job Result (NIP-90 standard kind 6300). */
export const KIND_QUERY_RESPONSE = 6300;
/** Anchr Job Feedback — offers / selection / completion (NIP-90 standard kind 7000). */
export const KIND_QUERY_FEEDBACK = 7000;
/** NIP-44 encrypted DM (kind 4). */
export const KIND_DIRECT_MESSAGE = 4;

/** Pair of secret + derived public key (both hex). */
export interface Keypair {
  secretKey: Uint8Array;
  publicKey: string;
}

export interface NostrSigner {
  readonly manifest?: AdapterManifest;
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate | UnsignedEvent): Promise<Event>;
}

export interface Nip07Provider {
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate | UnsignedEvent): Promise<Event>;
}

export class Nip07UnavailableError extends Error {
  constructor() {
    super("NIP-07 provider is not available");
    this.name = "Nip07UnavailableError";
  }
}

/** Generate a fresh keypair. The secret key is a 32-byte CSPRNG value. */
export function generateKeypair(): Keypair {
  const secretKey = generateSecretKey();
  return { secretKey, publicKey: getPublicKey(secretKey) };
}

export function createKeypairSigner(identity: Keypair): NostrSigner {
  return {
    manifest: {
      id: "nostr-keypair-signer",
      technology: "nostr",
      capabilities: ["signer"],
      runtimes: ["browser", "deno", "node", "worker"],
      experimental: false,
    },
    getPublicKey(): Promise<string> {
      return Promise.resolve(identity.publicKey);
    },
    signEvent(template: EventTemplate | UnsignedEvent): Promise<Event> {
      return Promise.resolve(signEvent(template, identity.secretKey));
    },
  };
}

export function createNip07Signer(provider?: Nip07Provider): NostrSigner {
  const resolved = provider ?? resolveWindowNostr();
  if (resolved === null) {
    throw new Nip07UnavailableError();
  }
  return {
    manifest: {
      id: "nip07-signer",
      technology: "nostr-nip07",
      capabilities: ["signer"],
      runtimes: ["browser"],
      experimental: false,
    },
    getPublicKey(): Promise<string> {
      return resolved.getPublicKey();
    },
    signEvent(template: EventTemplate | UnsignedEvent): Promise<Event> {
      return resolved.signEvent(template);
    },
  };
}

/**
 * Decode a hex-or-npub string to its 32-byte hex form. Accepts either
 * raw 64-char hex or a "npub1..." Bech32 string.
 *
 * Throws if the input is neither.
 */
export function normalizePubkey(input: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(input)) {
    return input.toLowerCase();
  }
  if (input.startsWith("npub1")) {
    const decoded = nip19Decode(input);
    if (decoded.type !== "npub") {
      throw new Error(`Expected npub bech32, got: ${decoded.type}`);
    }
    return decoded.data;
  }
  throw new Error(`Not a valid pubkey (hex or npub): ${input}`);
}

/**
 * Decode a hex-or-nsec string to a 32-byte secret key. Accepts either
 * raw 64-char hex or a "nsec1..." Bech32 string.
 */
export function normalizeSecretKey(input: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(input)) {
    return hexToBytes(input);
  }
  if (input.startsWith("nsec1")) {
    const decoded = nip19Decode(input);
    if (decoded.type !== "nsec") {
      throw new Error(`Expected nsec bech32, got: ${decoded.type}`);
    }
    return decoded.data;
  }
  throw new Error("Not a valid secret key (hex or nsec)");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Encrypt content from `senderSecretKey` to `recipientPubkey` via NIP-44 v2. */
export function encryptNip44(
  content: string,
  senderSecretKey: Uint8Array,
  recipientPubkey: string,
): string {
  const key = getConversationKey(senderSecretKey, recipientPubkey);
  return nip44Encrypt(content, key);
}

/** Decrypt content sent to `recipientSecretKey` from `senderPubkey` via NIP-44 v2. */
export function decryptNip44(
  ciphertext: string,
  recipientSecretKey: Uint8Array,
  senderPubkey: string,
): string {
  const key = getConversationKey(recipientSecretKey, senderPubkey);
  return nip44Decrypt(ciphertext, key);
}

/** Sign a template into a finalized Nostr event. */
export function signEvent(
  template: EventTemplate | UnsignedEvent,
  secretKey: Uint8Array,
): Event {
  return finalizeEvent(template, secretKey);
}

function resolveWindowNostr(): Nip07Provider | null {
  const value: unknown = Reflect.get(globalThis, "nostr");
  if (!isNip07Provider(value)) return null;
  return value;
}

function isNip07Provider(value: unknown): value is Nip07Provider {
  if (typeof value !== "object" || value === null) return false;
  const getPublicKey = "getPublicKey" in value ? value.getPublicKey : undefined;
  const signer = "signEvent" in value ? value.signEvent : undefined;
  return typeof getPublicKey === "function" && typeof signer === "function";
}

/**
 * Anything with a Nostr-style `tags` field. The tag helpers below only
 * inspect `tags`, so they accept any object with that shape.
 */
export interface HasTags {
  tags: string[][];
}

/** Find the first tag with the given key; returns the value (second element) or null. */
export function findTagValue(event: HasTags, key: string): string | null {
  for (const t of event.tags) {
    if (t[0] === key) return t[1] ?? null;
  }
  return null;
}

/** Find all tag values for a given key. */
export function findAllTagValues(event: HasTags, key: string): string[] {
  const out: string[] = [];
  for (const t of event.tags) {
    if (t[0] === key && t[1] !== undefined) out.push(t[1]);
  }
  return out;
}

export type { Event, EventTemplate, UnsignedEvent };
