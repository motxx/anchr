import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  deriveRegionKey,
  deriveConversationKey,
  encryptNip44,
  decryptNip44,
} from "./encryption";
import { generateEphemeralIdentity } from "./identity";

describe("Nostr encryption", () => {
  test("derives deterministic region keys", () => {
    const key1 = deriveRegionKey("IR");
    const key2 = deriveRegionKey("IR");
    const key3 = deriveRegionKey("CN");

    expect(key1).toEqual(key2);
    expect(key1).not.toEqual(key3);
    expect(key1.length).toBe(32); // SHA-256 = 32 bytes
  });

  test("region key is case-insensitive", () => {
    const key1 = deriveRegionKey("ir");
    const key2 = deriveRegionKey("IR");
    expect(key1).toEqual(key2);
  });

  test("NIP-44 encrypt/decrypt roundtrip", () => {
    const alice = generateEphemeralIdentity();
    const bob = generateEphemeralIdentity();

    const aliceConvKey = deriveConversationKey(alice.secretKey, bob.publicKey);
    const bobConvKey = deriveConversationKey(bob.secretKey, alice.publicKey);

    const plaintext = JSON.stringify({
      text_answer: "テヘランの街は平穏です",
      nonce_echo: "K7P4",
    });

    const encrypted = encryptNip44(plaintext, aliceConvKey);
    expect(encrypted).not.toBe(plaintext);

    // Bob can decrypt with his conversation key
    const decrypted = decryptNip44(encrypted, bobConvKey);
    expect(decrypted).toBe(plaintext);
  });

  test("different conversation keys cannot decrypt", () => {
    const alice = generateEphemeralIdentity();
    const bob = generateEphemeralIdentity();
    const charlie = generateEphemeralIdentity();

    const aliceBobKey = deriveConversationKey(alice.secretKey, bob.publicKey);
    const charlieKey = deriveConversationKey(charlie.secretKey, alice.publicKey);

    const encrypted = encryptNip44("secret message", aliceBobKey);

    expect(() => decryptNip44(encrypted, charlieKey)).toThrow();
  });
});
