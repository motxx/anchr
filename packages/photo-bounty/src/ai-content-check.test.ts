import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createAiContentChecker, type AiContentCheckDeps } from "./ai-content-check.ts";
import type { Query, QueryResult } from "@anchr/core-domain/types";

const baseQuery: Query = {
  id: "q1",
  status: "pending",
  description: "Photo of Tokyo Tower",
  challenge_nonce: "ABC123",
  challenge_rule: "test",
  verification_requirements: ["ai_check"],
  created_at: Date.now(),
  expires_at: Date.now() + 60_000,
  payment_status: "none",
};

const noopReadAttachment: AiContentCheckDeps["readAttachment"] = async () => null;

describe("createAiContentChecker", () => {
  test("returns null when disabled via getConfig", async () => {
    const check = createAiContentChecker({
      getConfig: () => ({ enabled: false }),
      readAttachment: noopReadAttachment,
    });
    const result = await check(baseQuery, {
      attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg", storage_kind: "external" }],
    } as QueryResult);
    expect(result).toBeNull();
  });

  test("returns null when API key missing even if enabled", async () => {
    const check = createAiContentChecker({
      getConfig: () => ({ enabled: true, anthropicApiKey: undefined }),
      readAttachment: noopReadAttachment,
    });
    const result = await check(baseQuery, {
      attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg", storage_kind: "external" }],
    } as QueryResult);
    expect(result).toBeNull();
  });

  test("returns null when attachments empty", async () => {
    const check = createAiContentChecker({
      getConfig: () => ({ enabled: true, anthropicApiKey: "sk-test" }),
      readAttachment: noopReadAttachment,
    });
    const result = await check(baseQuery, { attachments: [] } as QueryResult);
    expect(result).toBeNull();
  });

  test("returns null when all attachments have unsupported MIME", async () => {
    const check = createAiContentChecker({
      getConfig: () => ({ enabled: true, anthropicApiKey: "sk-test" }),
      readAttachment: noopReadAttachment,
    });
    const result = await check(baseQuery, {
      attachments: [
        { id: "a1", uri: "https://example.com/file.pdf", mime_type: "application/pdf", storage_kind: "external" },
        { id: "a2", uri: "https://example.com/file.txt", mime_type: "text/plain", storage_kind: "external" },
      ],
    } as QueryResult);
    expect(result).toBeNull();
  });

  test("getConfig is called per check (dynamic config)", async () => {
    let enabledFlag = false;
    const check = createAiContentChecker({
      getConfig: () => ({ enabled: enabledFlag, anthropicApiKey: undefined }),
      readAttachment: noopReadAttachment,
    });

    // First call: disabled
    let r = await check(baseQuery, {
      attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg", storage_kind: "external" }],
    } as QueryResult);
    expect(r).toBeNull();

    // Toggle: enabled but no API key → still null but for different reason
    enabledFlag = true;
    r = await check(baseQuery, {
      attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg", storage_kind: "external" }],
    } as QueryResult);
    expect(r).toBeNull();
  });
});
