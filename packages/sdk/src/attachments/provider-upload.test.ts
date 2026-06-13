import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { hexToBytes } from "@noble/hashes/utils.js";
import { decryptBlob } from "./blossom.ts";
import { providerUpload } from "./provider-upload.ts";

function buildJpegWithExif(): Uint8Array {
  const bytes = [
    0xff,
    0xd8,
    0xff,
    0xe1,
    0x00,
    0x12,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x47,
    0x50,
    0x53,
    0x3a,
    0x31,
    0x33,
    0x39,
    0x2e,
    0x37,
    0x00,
    0xff,
    0xda,
    0x00,
    0x04,
    0x00,
    0x00,
    0x42,
    0xff,
    0xd9,
  ];
  return new Uint8Array(bytes);
}

describe("providerUpload", () => {
  test("does not strip metadata before upload; callers are responsible", async () => {
    const savedFetch = globalThis.fetch;
    let uploadedBody: BodyInit | null | undefined;
    const fetchImpl: typeof fetch = (_input, init) => {
      uploadedBody = init?.body;
      return Promise.resolve(new Response(null, { status: 200 }));
    };
    globalThis.fetch = fetchImpl;

    try {
      const original = buildJpegWithExif();
      const result = await providerUpload(
        original,
        "photo.jpg",
        "image/jpeg",
        { servers: ["https://blossom.test.example"] },
      );

      expect(result).not.toBeNull();
      expect(result?.attachment.size_bytes).toBe(original.length);
      if (!(uploadedBody instanceof ArrayBuffer)) {
        throw new Error("expected Blossom upload body to be an ArrayBuffer");
      }

      const decrypted = await decryptBlob(
        new Uint8Array(uploadedBody),
        hexToBytes(result!.blossom.encryptKey),
        hexToBytes(result!.blossom.encryptIv),
      );

      expect(decrypted).toEqual(original);
      expect(new TextDecoder().decode(decrypted)).toContain("Exif");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
