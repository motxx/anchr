import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  buildAttachmentAbsoluteUrl,
  normalizeResultAttachments,
  resolveStoredAttachment,
} from "./access.ts";

test("resolveStoredAttachment accepts absolute URLs", () => {
  const attachment = resolveStoredAttachment(
    "https://cdn.example.com/query/image.png",
  );

  expect(attachment).not.toBeNull();
  expect(attachment?.storageKind).toBe("external");
  expect(attachment?.absoluteUrl).toBe(
    "https://cdn.example.com/query/image.png",
  );
});

test("resolveStoredAttachment returns null for relative paths", () => {
  expect(resolveStoredAttachment("/some/path")).toBeNull();
});

test("buildAttachmentAbsoluteUrl keeps external URLs", () => {
  expect(buildAttachmentAbsoluteUrl("https://cdn.example.com/query/image.png"))
    .toBe(
      "https://cdn.example.com/query/image.png",
    );
});

test("normalizeResultAttachments preserves blossom attachment refs", () => {
  const result = normalizeResultAttachments({
    attachments: [{
      id: "abc123",
      uri: "https://blossom.example.com/abc123",
      mime_type: "image/png",
      storage_kind: "blossom",
      blossom_hash: "abc123",
      blossom_servers: ["https://blossom.example.com"],
    }],
    notes: "ok",
  });

  expect(result.attachments[0]?.storage_kind).toBe("blossom");
  expect(result.attachments[0]?.blossom_hash).toBe("abc123");
});
