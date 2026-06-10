/**
 * Identity policy for the paid-request lifecycle (INV-07).
 *
 * Fresh ephemeral keypair per request is the default for every
 * orchestration path; persistent identities are an explicit caller
 * decision (restore from a stored secret). Key generation itself is the
 * protocol package's primitive — this module owns only the policy and the
 * serializable identity shape.
 */

import {
  generateKeypair,
  type Keypair,
  normalizeSecretKey,
} from "@anchr/protocol/nostr";
import { getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Keypair plus its hex-encoded secret for serialization. */
export interface NostrIdentity extends Keypair {
  secretKeyHex: string;
}

/** Generate a fresh ephemeral identity. Each request should use a new one. */
export function generateEphemeralIdentity(): NostrIdentity {
  const keypair = generateKeypair();
  return {
    secretKey: keypair.secretKey,
    publicKey: keypair.publicKey,
    secretKeyHex: bytesToHex(keypair.secretKey),
  };
}

/** Restore a persistent identity from a hex-encoded secret key. */
export function restoreIdentity(secretKeyHex: string): NostrIdentity {
  const secretKey = normalizeSecretKey(secretKeyHex);
  return {
    secretKey,
    publicKey: getPublicKey(secretKey),
    secretKeyHex,
  };
}
