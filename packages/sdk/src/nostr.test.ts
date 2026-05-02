import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  decryptNip44,
  encryptNip44,
  findAllTagValues,
  findTagValue,
  generateKeypair,
  KIND_DIRECT_MESSAGE,
  KIND_QUERY_FEEDBACK,
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
  normalizePubkey,
  normalizeSecretKey,
  signEvent,
} from "./nostr.ts";

test("NIP-90 / Anchr event kinds are the standard values", () => {
  expect(KIND_QUERY_REQUEST).toBe(5300);
  expect(KIND_QUERY_RESPONSE).toBe(6300);
  expect(KIND_QUERY_FEEDBACK).toBe(7000);
  expect(KIND_DIRECT_MESSAGE).toBe(4);
});

test("generateKeypair produces a 32-byte secret + 64-char hex pubkey", () => {
  const kp = generateKeypair();
  expect(kp.secretKey).toBeInstanceOf(Uint8Array);
  expect(kp.secretKey.length).toBe(32);
  expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/);
});

test("generateKeypair produces unique keys", () => {
  const a = generateKeypair();
  const b = generateKeypair();
  expect(a.publicKey).not.toBe(b.publicKey);
});

test("normalizePubkey accepts hex and lowercases it", () => {
  const hex = "ABCDEF0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789";
  expect(normalizePubkey(hex)).toBe(hex.toLowerCase());
});

test("normalizePubkey rejects malformed input", () => {
  expect(() => normalizePubkey("not-a-pubkey")).toThrow();
  expect(() => normalizePubkey("xyz")).toThrow();
});

test("normalizeSecretKey accepts hex and returns 32 bytes", () => {
  const hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const bytes = normalizeSecretKey(hex);
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(bytes.length).toBe(32);
});

test("normalizeSecretKey rejects malformed input", () => {
  expect(() => normalizeSecretKey("not-an-nsec")).toThrow();
});

test("NIP-44 encrypt / decrypt round-trips between two keypairs", () => {
  const alice = generateKeypair();
  const bob = generateKeypair();
  const message = "hello, anchr-sdk — this is a test message with non-ASCII: 日本語 + 🔐";

  const ciphertext = encryptNip44(message, alice.secretKey, bob.publicKey);
  expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/);

  const recovered = decryptNip44(ciphertext, bob.secretKey, alice.publicKey);
  expect(recovered).toBe(message);
});

test("NIP-44 ciphertext changes between identical encryptions (random nonce)", () => {
  const alice = generateKeypair();
  const bob = generateKeypair();
  const message = "same message";
  const c1 = encryptNip44(message, alice.secretKey, bob.publicKey);
  const c2 = encryptNip44(message, alice.secretKey, bob.publicKey);
  expect(c1).not.toBe(c2);
});

test("NIP-44 decrypt fails when the wrong recipient key is used", () => {
  const alice = generateKeypair();
  const bob = generateKeypair();
  const eve = generateKeypair();
  const ciphertext = encryptNip44("secret", alice.secretKey, bob.publicKey);
  expect(() => decryptNip44(ciphertext, eve.secretKey, alice.publicKey)).toThrow();
});

test("signEvent produces a signed Event with id and sig", () => {
  const kp = generateKeypair();
  const event = signEvent(
    {
      kind: KIND_QUERY_REQUEST,
      tags: [["d", "test"]],
      content: "hello",
      created_at: Math.floor(Date.now() / 1000),
    },
    kp.secretKey,
  );
  expect(event.kind).toBe(KIND_QUERY_REQUEST);
  expect(event.pubkey).toBe(kp.publicKey);
  expect(event.id).toMatch(/^[0-9a-f]{64}$/);
  expect(event.sig).toMatch(/^[0-9a-f]{128}$/);
});

test("findTagValue returns the second element of the first matching tag", () => {
  const event = {
    tags: [
      ["d", "schema-uri"],
      ["p", "alice"],
      ["p", "bob"],
    ],
  };
  expect(findTagValue(event, "d")).toBe("schema-uri");
  expect(findTagValue(event, "p")).toBe("alice");
  expect(findTagValue(event, "missing")).toBe(null);
});

test("findAllTagValues returns every matching tag's value", () => {
  const event = {
    tags: [
      ["p", "alice"],
      ["p", "bob"],
      ["e", "evt"],
    ],
  };
  expect(findAllTagValues(event, "p")).toEqual(["alice", "bob"]);
  expect(findAllTagValues(event, "e")).toEqual(["evt"]);
  expect(findAllTagValues(event, "missing")).toEqual([]);
});
