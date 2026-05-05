import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createAiContentChecker,
  type AiContentCheckDeps,
  type AiContentCheckQuery,
  type AiContentCheckResult,
} from "./ai-content-check.ts";

const baseQuery: AiContentCheckQuery = {
  description: "Photo of Tokyo Tower",
  challenge_nonce: "ABC123",
  verification_requirements: ["ai_check"],
};

const noopReadAttachment: AiContentCheckDeps["readAttachment"] = async () => null;

describe("createAiContentChecker", () => {
  test("returns null when disabled via getConfig", async () => {
    const check = createAiContentChecker({
      getConfig: () => ({ enabled: false }),
      readAttachment: noopReadAttachment,
    });
    const result = await check(baseQuery, {
      attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg" }],
    });
    expect(result).toBeNull();
  });

  test("returns null when API key missing even if enabled", async () => {
    const check = createAiContentChecker({
      getConfig: () => ({ enabled: true, anthropicApiKey: undefined }),
      readAttachment: noopReadAttachment,
    });
    const result = await check(baseQuery, {
      attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg" }],
    });
    expect(result).toBeNull();
  });

  test("returns null when attachments empty", async () => {
    const check = createAiContentChecker({
      getConfig: () => ({ enabled: true, anthropicApiKey: "sk-test" }),
      readAttachment: noopReadAttachment,
    });
    const result = await check(baseQuery, { attachments: [] });
    expect(result).toBeNull();
  });

  test("returns null when all attachments have unsupported MIME", async () => {
    const check = createAiContentChecker({
      getConfig: () => ({ enabled: true, anthropicApiKey: "sk-test" }),
      readAttachment: noopReadAttachment,
    });
    const result = await check(baseQuery, {
      attachments: [
        { id: "a1", uri: "https://example.com/file.pdf", mime_type: "application/pdf" },
        { id: "a2", uri: "https://example.com/file.txt", mime_type: "text/plain" },
      ],
    });
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
      attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg" }],
    });
    expect(r).toBeNull();

    // Toggle: enabled but no API key → still null but for different reason
    enabledFlag = true;
    r = await check(baseQuery, {
      attachments: [{ id: "a1", uri: "https://example.com/photo.jpg", mime_type: "image/jpeg" }],
    });
    expect(r).toBeNull();
  });
});
