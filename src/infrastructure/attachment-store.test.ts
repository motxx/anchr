import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { uploadAttachment } from "./attachment-store";

describe("uploadAttachment", () => {
  test("throws when Blossom is not configured", async () => {
    const saved = process.env.BLOSSOM_SERVERS;
    delete process.env.BLOSSOM_SERVERS;

    try {
      const file = new File([new Uint8Array([0xFF, 0xD8])], "photo.jpg", { type: "image/jpeg" });
      await expect(uploadAttachment("q1", file)).rejects.toThrow("Blossom is not configured");
    } finally {
      if (saved !== undefined) process.env.BLOSSOM_SERVERS = saved;
    }
  });

  test("rejects invalid zip (no photo inside) when Blossom is configured", async () => {
    const saved = process.env.BLOSSOM_SERVERS;
    process.env.BLOSSOM_SERVERS = "http://localhost:9999";

    try {
      // PK magic bytes → detected as zip, but contains no photo
      const fakeZip = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const file = new File([fakeZip], "bundle.zip", { type: "application/zip" });
      await expect(uploadAttachment("q1", file)).rejects.toThrow("Invalid zip");
    } finally {
      if (saved !== undefined) process.env.BLOSSOM_SERVERS = saved;
      else delete process.env.BLOSSOM_SERVERS;
    }
  });

  test("detects zip by magic bytes even without .zip extension", async () => {
    const saved = process.env.BLOSSOM_SERVERS;
    process.env.BLOSSOM_SERVERS = "http://localhost:9999";

    try {
      // PK header but named .jpg — should still be treated as zip
      const fakeZip = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const file = new File([fakeZip], "disguised.jpg", { type: "image/jpeg" });
      // Will be detected as zip due to PK magic bytes → "Invalid zip: no photo found"
      await expect(uploadAttachment("q1", file)).rejects.toThrow("Invalid zip");
    } finally {
      if (saved !== undefined) process.env.BLOSSOM_SERVERS = saved;
      else delete process.env.BLOSSOM_SERVERS;
    }
  });
});
