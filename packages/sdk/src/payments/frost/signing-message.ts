/**
 * Single owner of the FROST signing-message derivation. The coordinator,
 * the signature adapter, and every peer signer must agree on this mapping:
 * a peer only signs the message it can re-derive from the requirement it
 * verified itself, so a coordinator cannot swap in an arbitrary message.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export function deriveFrostSigningMessage(queryId: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`anchr:sign:${queryId}`)));
}
