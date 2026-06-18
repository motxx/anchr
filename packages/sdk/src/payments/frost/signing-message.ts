import { getDecodedToken } from "@cashu/cashu-ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const TEXT_ENCODER = new TextEncoder();

export function deriveFrostSigningMessage(queryId: string): string {
  return sha256Utf8Hex(`anchr:sign:${queryId}`);
}

export function deriveFrostEscrowTokenHash(encodedToken: string): string {
  return sha256Utf8Hex(encodedToken);
}

export function deriveFrostP2pkMessages(
  encodedToken: string,
  knownKeysets?: readonly string[],
): string[] {
  const decoded = getDecodedToken(
    encodedToken,
    knownKeysets === undefined ? undefined : [...knownKeysets],
  );
  return decoded.proofs.map((proof) => sha256Utf8Hex(proof.secret));
}

export function tokenMatchesFrostP2pkLock(
  encodedToken: string,
  groupPubkey: string,
  knownKeysets?: readonly string[],
): boolean {
  try {
    const decoded = getDecodedToken(
      encodedToken,
      knownKeysets === undefined ? undefined : [...knownKeysets],
    );
    return decoded.proofs.length > 0 &&
      decoded.proofs.every((proof) =>
        p2pkSecretRequiresGroup(proof.secret, groupPubkey)
      );
  } catch {
    return false;
  }
}

function sha256Utf8Hex(value: string): string {
  return bytesToHex(sha256(TEXT_ENCODER.encode(value)));
}

function p2pkSecretRequiresGroup(
  secretJson: string,
  groupPubkey: string,
): boolean {
  const parsed = parseJson(secretJson);
  if (!Array.isArray(parsed) || parsed[0] !== "P2PK") return false;
  const body = parsed[1];
  if (!isRecord(body)) return false;

  const lockPubkeys: string[] = [];
  if (typeof body.data === "string") lockPubkeys.push(body.data);

  let nSigs = "";
  const tags = body.tags;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (!isStringArray(tag) || tag.length === 0) continue;
      if (tag[0] === "pubkeys") lockPubkeys.push(...tag.slice(1));
      if (tag[0] === "n_sigs" && typeof tag[1] === "string") nSigs = tag[1];
    }
  }

  return nSigs === "2" &&
    lockPubkeys.some((pubkey) => sameXOnlyPubkey(pubkey, groupPubkey));
}

function sameXOnlyPubkey(candidate: string, expected: string): boolean {
  return toXOnly(candidate).toLowerCase() === toXOnly(expected).toLowerCase();
}

function toXOnly(pubkey: string): string {
  if (
    pubkey.length === 66 &&
    (pubkey.startsWith("02") || pubkey.startsWith("03"))
  ) {
    return pubkey.slice(2);
  }
  return pubkey;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string");
}
