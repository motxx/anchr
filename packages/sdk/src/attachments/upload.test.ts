import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { uploadAttachment } from "./upload.ts";
import type { AttachmentRuntimeConfig } from "../internal/runtime/config.ts";

const noBlossomConfig: AttachmentRuntimeConfig = {
  publicBaseUrl: undefined,
  allowLocalhostAttachments: false,
  blossomServers: [],
};

const blossomConfig: AttachmentRuntimeConfig = {
  ...noBlossomConfig,
  blossomServers: ["http://localhost:9999"],
};

describe("uploadAttachment", () => {
  test("throws when Blossom is not configured", async () => {
    const file = new File([new Uint8Array([0xFF, 0xD8])], "photo.jpg", {
      type: "image/jpeg",
    });
    await expect(uploadAttachment("q1", file, { config: noBlossomConfig }))
      .rejects.toThrow(
        "Blossom is not configured",
      );
  });

  test("rejects invalid zip (no photo inside) when Blossom is configured", async () => {
    // PK magic bytes → detected as zip, but contains no photo
    const fakeZip = new Uint8Array([
      0x50,
      0x4B,
      0x03,
      0x04,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    const file = new File([fakeZip], "bundle.zip", {
      type: "application/zip",
    });
    await expect(uploadAttachment("q1", file, { config: blossomConfig }))
      .rejects.toThrow("Invalid zip");
  });

  test("detects zip by magic bytes even without .zip extension", async () => {
    // PK header but named .jpg — should still be treated as zip
    const fakeZip = new Uint8Array([
      0x50,
      0x4B,
      0x03,
      0x04,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    const file = new File([fakeZip], "disguised.jpg", { type: "image/jpeg" });
    await expect(uploadAttachment("q1", file, { config: blossomConfig }))
      .rejects.toThrow("Invalid zip");
  });
});
