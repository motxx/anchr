import { generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export interface NostrIdentity {
  secretKey: Uint8Array;
  publicKey: string;
  secretKeyHex: string;
}

export function generateIdentity(): NostrIdentity {
  const secretKey = generateSecretKey();
  const publicKey = getPublicKey(secretKey);
  return {
    secretKey,
    publicKey,
    secretKeyHex: bytesToHex(secretKey),
  };
}

export function restoreIdentity(secretKeyHex: string): NostrIdentity {
  const secretKey = hexToBytes(secretKeyHex);
  const publicKey = getPublicKey(secretKey);
  return { secretKey, publicKey, secretKeyHex };
}
