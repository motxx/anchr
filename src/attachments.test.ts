import { expect, test } from "bun:test";
import {
  buildAttachmentAccess,
  buildAttachmentHandle,
  buildAttachmentAbsoluteUrl,
  buildQueryAttachmentUrls,
  materializeQueryResult,
  normalizeQueryResult,
  resolveStoredAttachment,
} from "./attachments";

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

test("materializeQueryResult expands local attachment refs to absolute URLs", () => {
  const result = materializeQueryResult({
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
  }, "http://localhost:3000/queries/query_1");

  expect(result.type).toBe("photo_proof");
  if (result.type !== "photo_proof") {
    throw new Error("expected photo_proof result");
  }
  expect(result.attachments[0]?.uri).toBe("http://localhost:3000/uploads/example.png");
});

test("buildQueryAttachmentUrls returns stable query attachment endpoints", () => {
  const urls = buildQueryAttachmentUrls("query_1", 2, "http://localhost:3000/queries/query_1");

  expect(urls.viewUrl).toBe("http://localhost:3000/queries/query_1/attachments/2");
  expect(urls.metaUrl).toBe("http://localhost:3000/queries/query_1/attachments/2/meta");
  expect(urls.previewUrl).toBe("http://localhost:3000/queries/query_1/attachments/2/preview");
});

test("buildAttachmentAccess keeps delivery URLs separate from attachment identity", () => {
  const access = buildAttachmentAccess(
    "query_1",
    0,
    "/uploads/example.png",
    "http://localhost:3000/queries/query_1",
  );

  expect(access.original_url).toBe("http://localhost:3000/uploads/example.png");
  expect(access.preview_url).toBe("http://localhost:3000/queries/query_1/attachments/0/preview");
  expect(access.view_url).toBe("http://localhost:3000/queries/query_1/attachments/0");
  expect(access.meta_url).toBe("http://localhost:3000/queries/query_1/attachments/0/meta");
});

test("buildAttachmentHandle returns attachment plus derived access info", () => {
  const handle = buildAttachmentHandle(
    "query_1",
    0,
    "/uploads/example.png",
    "http://localhost:3000/queries/query_1",
  );

  expect(handle.attachment.uri).toBe("http://localhost:3000/uploads/example.png");
  expect(handle.access.original_url).toBe("http://localhost:3000/uploads/example.png");
  expect(handle.access.preview_url).toBe("http://localhost:3000/queries/query_1/attachments/0/preview");
  expect(handle.access.view_url).toBe("http://localhost:3000/queries/query_1/attachments/0");
});
