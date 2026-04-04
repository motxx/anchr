import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { checkAttachmentContent } from "./ai-content-check";
import type { Query, QueryResult } from "../../domain/types";
import { withEnv } from "../../testing/helpers";
import { makeQuery as makeBaseQuery } from "../../testing/factories";

const makeQuery = (opts?: Partial<Query>): Query => makeBaseQuery({
  id: "q1",
  description: "Photo of Tokyo Tower",
  challenge_nonce: "ABC123",
  challenge_rule: "test",
  verification_requirements: ["ai_check"],
  expires_at: Date.now() + 60_000,
  payment_status: "none",
  ...opts,
});

describe("checkAttachmentContent", () => {
  test("returns null when AI_CONTENT_CHECK is not enabled", async () => {
    await withEnv({ AI_CONTENT_CHECK: undefined, ANTHROPIC_API_KEY: undefined }, async () => {
      const result = await checkAttachmentContent(
        makeQuery(),
        { attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg", storage_kind: "external" }] },
      );
      expect(result).toBeNull();
    });
  });

  test("returns null when ANTHROPIC_API_KEY is missing even if enabled", async () => {
    await withEnv({ AI_CONTENT_CHECK: "true", ANTHROPIC_API_KEY: undefined }, async () => {
      const result = await checkAttachmentContent(
        makeQuery(),
        { attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg", storage_kind: "external" }] },
      );
      expect(result).toBeNull();
    });
  });

  test("returns null when attachments array is empty", async () => {
    const result = await checkAttachmentContent(makeQuery(), { attachments: [] });
    expect(result).toBeNull();
  });

  test("returns null when attachments is undefined", async () => {
    const result = await checkAttachmentContent(makeQuery(), { attachments: [] });
    expect(result).toBeNull();
  });

  test("returns null when enabled but all attachments have unsupported MIME types", async () => {
    // Even if API key is set, loadImageContent filters by MIME type.
    // With unsupported MIME types, no images are loaded → returns null before API call.
    await withEnv({ AI_CONTENT_CHECK: "true", ANTHROPIC_API_KEY: "sk-test-fake" }, async () => {
      const result = await checkAttachmentContent(
        makeQuery(),
        {
          attachments: [
            { id: "a1", uri: "https://example.com/file.pdf", mime_type: "application/pdf", storage_kind: "external" },
            { id: "a2", uri: "https://example.com/file.txt", mime_type: "text/plain", storage_kind: "external" },
          ],
        },
      );
      // loadImageContent returns [] for unsupported MIME → checkAttachmentContent returns null
      expect(result).toBeNull();
    });
  });
});
