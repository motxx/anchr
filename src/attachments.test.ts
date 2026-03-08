import { expect, test } from "bun:test";
import { buildAttachmentAbsoluteUrl, normalizeQueryResult, resolveStoredAttachment } from "./attachments";

test("resolveStoredAttachment accepts upload paths", () => {
  const attachment = resolveStoredAttachment("/uploads/example.png");

  expect(attachment).not.toBeNull();
  expect(attachment?.filename).toBe("example.png");
  expect(attachment?.mimeType).toBe("image/png");
});

test("resolveStoredAttachment rejects non-upload paths", () => {
  expect(resolveStoredAttachment("/uploads/../../etc/passwd")).toBeNull();
});

test("resolveStoredAttachment accepts absolute URLs", () => {
  const attachment = resolveStoredAttachment("https://cdn.example.com/query/image.png");

  expect(attachment).not.toBeNull();
  expect(attachment?.storageKind).toBe("external");
  expect(attachment?.absoluteUrl).toBe("https://cdn.example.com/query/image.png");
});

test("buildAttachmentAbsoluteUrl keeps external URLs and expands local paths", () => {
  expect(buildAttachmentAbsoluteUrl("https://cdn.example.com/query/image.png")).toBe(
    "https://cdn.example.com/query/image.png",
  );
  expect(buildAttachmentAbsoluteUrl("/uploads/image.png", "http://localhost:3000/queries/1")).toBe(
    "http://localhost:3000/uploads/image.png",
  );
});

test("normalizeQueryResult preserves structured attachment refs", () => {
  const result = normalizeQueryResult({
    type: "photo_proof",
    text_answer: "Observed storefront K7P4",
    attachments: [{
      id: "example.png",
      uri: "/uploads/example.png",
      mime_type: "image/png",
      storage_kind: "local",
      route_path: "/uploads/example.png",
    }],
    notes: "ok",
  });

  expect(result.type).toBe("photo_proof");
  if (result.type !== "photo_proof") {
    throw new Error("expected photo_proof result");
  }
  expect(result.attachments).toEqual([{
    id: "example.png",
    uri: "/uploads/example.png",
    mime_type: "image/png",
    storage_kind: "local",
    filename: "example.png",
    size_bytes: undefined,
    local_file_path: expect.any(String),
    route_path: "/uploads/example.png",
  }]);
});
