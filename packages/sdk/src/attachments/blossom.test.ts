import { Buffer } from "node:buffer";
import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  decryptBlob,
  encryptBlob,
  getBlossomConfig,
  isBlossomEnabled,
} from "./blossom.ts";

describe("Blossom client", () => {
  test("encrypt/decrypt roundtrip", async () => {
    const original = new TextEncoder().encode(
      "テヘランの街は平穏です。写真証拠。",
    );

    const { encrypted, key, iv } = await encryptBlob(original);

    expect(encrypted.length).toBeGreaterThan(original.length); // GCM tag adds 16 bytes
    expect(Buffer.from(encrypted).toString()).not.toBe(
      Buffer.from(original).toString(),
    );

    const decrypted = await decryptBlob(encrypted, key, iv);
    expect(Buffer.from(decrypted).toString()).toBe(
      Buffer.from(original).toString(),
    );
  });

  test("different encryptions produce different ciphertexts", async () => {
    const data = new TextEncoder().encode("same data");

    const result1 = await encryptBlob(data);
    const result2 = await encryptBlob(data);

    expect(Buffer.from(result1.key)).not.toEqual(Buffer.from(result2.key));
    expect(Buffer.from(result1.iv)).not.toEqual(Buffer.from(result2.iv));

    expect(Buffer.from(result1.encrypted)).not.toEqual(
      Buffer.from(result2.encrypted),
    );

    const d1 = await decryptBlob(result1.encrypted, result1.key, result1.iv);
    const d2 = await decryptBlob(result2.encrypted, result2.key, result2.iv);
    expect(Buffer.from(d1)).toEqual(Buffer.from(d2));
  });

  test("wrong key fails to decrypt", async () => {
    const data = new TextEncoder().encode("secret");
    const { encrypted, iv } = await encryptBlob(data);
    const wrongKey = crypto.getRandomValues(new Uint8Array(32));

    await expect(decryptBlob(encrypted, wrongKey, iv)).rejects.toThrow();
  });

  test("isBlossomEnabled returns false when not configured", () => {
    const original = Deno.env.get("BLOSSOM_SERVERS");
    Deno.env.delete("BLOSSOM_SERVERS");

    expect(isBlossomEnabled()).toBe(false);
    expect(getBlossomConfig()).toBe(null);

    if (original) Deno.env.set("BLOSSOM_SERVERS", original);
  });

  test("getBlossomConfig parses comma-separated URLs", () => {
    const original = Deno.env.get("BLOSSOM_SERVERS");
    Deno.env.set(
      "BLOSSOM_SERVERS",
      "https://blossom1.example, https://blossom2.example/",
    );

    const config = getBlossomConfig();
    expect(config).not.toBe(null);
    expect(config!.servers).toEqual([
      "https://blossom1.example",
      "https://blossom2.example",
    ]);

    if (original) {
      Deno.env.set("BLOSSOM_SERVERS", original);
    } else {
      Deno.env.delete("BLOSSOM_SERVERS");
    }
  });
});
