import { expect, test } from "bun:test";
import { encryptBlob, decryptBlob } from "./client";

test("encryptBlob + decryptBlob round-trip", async () => {
  const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const { encrypted, key, iv } = await encryptBlob(original);

  expect(encrypted.length).toBeGreaterThan(original.length); // AES-GCM adds auth tag

  const decrypted = await decryptBlob(encrypted, key, iv);
  expect(decrypted).toEqual(original);
});

test("encryptBlob produces unique ciphertext each call", async () => {
  const data = new Uint8Array([42, 43, 44]);
  const a = await encryptBlob(data);
  const b = await encryptBlob(data);

  // Different key + IV → different ciphertext
  expect(a.encrypted).not.toEqual(b.encrypted);
});

test("decryptBlob fails with wrong key", async () => {
  const data = new Uint8Array([10, 20, 30]);
  const { encrypted, iv } = await encryptBlob(data);
  const wrongKey = new Uint8Array(32); // all zeros

  await expect(decryptBlob(encrypted, wrongKey, iv)).rejects.toThrow();
});
