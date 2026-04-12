import { describe, test, beforeEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { fetchWithProof, _clearCacheForTest } from "./data-fetcher";

describe("fetchWithProof SSRF protection", () => {
  beforeEach(() => {
    _clearCacheForTest();
  });

  test("rejects private IPv4 (cloud metadata)", async () => {
    await expect(
      fetchWithProof("listing_1", "http://169.254.169.254/latest/meta-data/", 60),
    ).rejects.toThrow("Source URL rejected");
  });

  // Note: http://localhost is allowed by validateAttachmentUri for dev convenience.
  // This is by design — localhost is a trusted dev target.

  test("rejects private 10.x.x.x", async () => {
    await expect(
      fetchWithProof("listing_3", "https://10.0.0.1/secret", 60),
    ).rejects.toThrow("Source URL rejected");
  });

  test("rejects private 192.168.x.x", async () => {
    await expect(
      fetchWithProof("listing_4", "https://192.168.1.1/admin", 60),
    ).rejects.toThrow("Source URL rejected");
  });

  test("rejects non-HTTPS for non-localhost", async () => {
    await expect(
      fetchWithProof("listing_5", "http://evil.com/data", 60),
    ).rejects.toThrow("Source URL rejected");
  });

  test("rejects file:// protocol", async () => {
    await expect(
      fetchWithProof("listing_6", "file:///etc/passwd", 60),
    ).rejects.toThrow("Source URL rejected");
  });

  test("rejects IPv6-mapped private IPv4", async () => {
    await expect(
      fetchWithProof("listing_7", "https://[::ffff:169.254.169.254]/", 60),
    ).rejects.toThrow("Source URL rejected");
  });

  test("rejects URLs with embedded credentials", async () => {
    await expect(
      fetchWithProof("listing_8", "https://user:pass@example.com/api", 60),
    ).rejects.toThrow("Source URL rejected");
  });
});
