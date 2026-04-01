import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { fetchBlossomAttachment } from "./fetch-attachment";
import type { AttachmentRef, BlossomKeyMaterial } from "../../domain/types";

/**
 * Tests for fetchBlossomAttachment guard logic.
 *
 * The function delegates to downloadFromBlossom for actual network calls.
 * We test the early-return guards that skip downloads when preconditions
 * are not met.
 */

describe("fetchBlossomAttachment", () => {
  const validKey: BlossomKeyMaterial = {
    encrypt_key: "abcdef1234567890abcdef1234567890",
    encrypt_iv: "1234567890abcdef",
  };

  test("returns null for non-blossom storage_kind", async () => {
    const ref: AttachmentRef = {
      id: "att1",
      uri: "https://example.com/photo.jpg",
      mime_type: "image/jpeg",
      storage_kind: "external",
      blossom_hash: "abc123",
    };

    const result = await fetchBlossomAttachment(ref, validKey);
    expect(result).toBeNull();
  });

  test("returns null when blossom_hash is missing", async () => {
    const ref: AttachmentRef = {
      id: "att1",
      uri: "https://blossom.example.com/abc",
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      // no blossom_hash
    };

    const result = await fetchBlossomAttachment(ref, validKey);
    expect(result).toBeNull();
  });

  test("returns null when keyMaterial is undefined", async () => {
    const ref: AttachmentRef = {
      id: "att1",
      uri: "https://blossom.example.com/abc123",
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      blossom_hash: "abc123",
    };

    const result = await fetchBlossomAttachment(ref, undefined);
    expect(result).toBeNull();
  });

  test("returns null when encrypt_key is missing", async () => {
    const ref: AttachmentRef = {
      id: "att1",
      uri: "https://blossom.example.com/abc123",
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      blossom_hash: "abc123",
    };

    const result = await fetchBlossomAttachment(ref, {
      encrypt_key: "",
      encrypt_iv: "1234567890abcdef",
    });
    expect(result).toBeNull();
  });

  test("returns null when encrypt_iv is missing", async () => {
    const ref: AttachmentRef = {
      id: "att1",
      uri: "https://blossom.example.com/abc123",
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      blossom_hash: "abc123",
    };

    const result = await fetchBlossomAttachment(ref, {
      encrypt_key: "abcdef1234567890abcdef1234567890",
      encrypt_iv: "",
    });
    expect(result).toBeNull();
  });
});
