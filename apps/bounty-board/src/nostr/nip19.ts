import { nip19 } from "nostr-tools";

export function nsecEncode(secretKeyHex: string): string {
  const bytes = hexToBytes(secretKeyHex);
  return nip19.nsecEncode(bytes);
}

export function npubEncode(publicKeyHex: string): string {
  return nip19.npubEncode(publicKeyHex);
}

export function nsecDecode(nsec: string): string {
  const { type, data } = nip19.decode(nsec);
  if (type !== "nsec") throw new Error("Not a valid nsec");
  return bytesToHex(data);
}

export function npubDecode(npub: string): string {
  const { type, data } = nip19.decode(npub);
  if (type !== "npub") throw new Error("Not a valid npub");
  return data;
}

export function isValidNsec(value: string): boolean {
  try {
    const { type } = nip19.decode(value);
    return type === "nsec";
  } catch {
    return false;
  }
}

export function isValidNpub(value: string): boolean {
  try {
    const { type } = nip19.decode(value);
    return type === "npub";
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
