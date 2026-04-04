import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  buildAttachmentAccess,
  buildAttachmentHandle,
  buildAttachmentAbsoluteUrl,
  buildQueryAttachmentUrls,
  materializeQueryResult,
  normalizeQueryResult,
  resolveStoredAttachment,
} from "./attachments";

test("resolveStoredAttachment accepts absolute URLs", () => {
  const attachment = resolveStoredAttachment("https://cdn.example.com/query/image.png");

  expect(attachment).not.toBeNull();
  expect(attachment?.storageKind).toBe("external");
  expect(attachment?.absoluteUrl).toBe("https://cdn.example.com/query/image.png");
});

test("resolveStoredAttachment returns null for relative paths", () => {
  expect(resolveStoredAttachment("/some/path")).toBeNull();
});

test("buildAttachmentAbsoluteUrl keeps external URLs", () => {
  expect(buildAttachmentAbsoluteUrl("https://cdn.example.com/query/image.png")).toBe(
    "https://cdn.example.com/query/image.png",
  );
});

test("normalizeQueryResult preserves blossom attachment refs", () => {
  const result = normalizeQueryResult({
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

test("materializeQueryResult expands blossom attachment refs", () => {
  const result = materializeQueryResult({
    attachments: [{
      id: "abc123",
      uri: "https://blossom.example.com/abc123",
      mime_type: "image/png",
      storage_kind: "blossom",
      blossom_hash: "abc123",
    }],
    notes: "ok",
  }, "http://localhost:3000/queries/query_1");

  expect(result.attachments[0]?.uri).toBe("https://blossom.example.com/abc123");
});

test("buildQueryAttachmentUrls returns stable query attachment endpoints", () => {
  const urls = buildQueryAttachmentUrls("query_1", 2, "http://localhost:3000/queries/query_1");

  expect(urls.viewUrl).toBe("http://localhost:3000/queries/query_1/attachments/2");
  expect(urls.metaUrl).toBe("http://localhost:3000/queries/query_1/attachments/2/meta");
  expect(urls.previewUrl).toBe("http://localhost:3000/queries/query_1/attachments/2/preview");
});

test("buildAttachmentAccess builds delivery URLs for blossom attachment", () => {
  const access = buildAttachmentAccess(
    "query_1",
    0,
    {
      id: "abc123",
      uri: "https://blossom.example.com/abc123",
      mime_type: "image/png",
      storage_kind: "blossom",
      blossom_hash: "abc123",
    },
    "http://localhost:3000/queries/query_1",
  );

  expect(access.original_url).toBe("https://blossom.example.com/abc123");
  expect(access.preview_url).toBe("http://localhost:3000/queries/query_1/attachments/0/preview");
  expect(access.view_url).toBe("http://localhost:3000/queries/query_1/attachments/0");
  expect(access.meta_url).toBe("http://localhost:3000/queries/query_1/attachments/0/meta");
});

test("buildAttachmentHandle returns attachment plus derived access info", () => {
  const handle = buildAttachmentHandle(
    "query_1",
    0,
    {
      id: "abc123",
      uri: "https://blossom.example.com/abc123",
      mime_type: "image/png",
      storage_kind: "blossom",
      blossom_hash: "abc123",
    },
    "http://localhost:3000/queries/query_1",
  );

  expect(handle.attachment.uri).toBe("https://blossom.example.com/abc123");
  expect(handle.access.original_url).toBe("https://blossom.example.com/abc123");
  expect(handle.access.preview_url).toBe("http://localhost:3000/queries/query_1/attachments/0/preview");
  expect(handle.access.view_url).toBe("http://localhost:3000/queries/query_1/attachments/0");
});
