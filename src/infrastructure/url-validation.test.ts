import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { validateAttachmentUri } from "./url-validation";

describe("validateAttachmentUri", () => {
  // --- Valid URLs ---
  test("accepts HTTPS URLs", () => {
    expect(validateAttachmentUri("https://example.com/photo.jpg")).toBeNull();
    expect(validateAttachmentUri("https://blossom.example.com/abc123")).toBeNull();
  });

  test("accepts http://localhost for dev", () => {
    expect(validateAttachmentUri("http://localhost:3333/blob")).toBeNull();
    expect(validateAttachmentUri("http://127.0.0.1:3333/blob")).toBeNull();
  });

  // --- Protocol ---
  test("rejects non-HTTPS for non-localhost", () => {
    expect(validateAttachmentUri("http://evil.com/data")).toContain("HTTPS");
  });

  test("rejects non-HTTP protocols", () => {
    expect(validateAttachmentUri("ftp://example.com/file")).toContain("HTTPS");
    expect(validateAttachmentUri("file:///etc/passwd")).toContain("HTTPS");
    expect(validateAttachmentUri("javascript:alert(1)")).not.toBeNull();
  });

  test("rejects invalid URLs", () => {
    expect(validateAttachmentUri("not a url")).toContain("Invalid");
    expect(validateAttachmentUri("")).toContain("Invalid");
  });

  // --- Embedded credentials ---
  test("rejects URLs with embedded credentials", () => {
    expect(validateAttachmentUri("https://user:pass@example.com/")).toContain("credentials");
    expect(validateAttachmentUri("https://admin@example.com/")).toContain("credentials");
  });

  // --- Private IPv4 ---
  test("rejects private IPv4 ranges", () => {
    expect(validateAttachmentUri("https://10.0.0.1/")).toContain("private");
    expect(validateAttachmentUri("https://172.16.0.1/")).toContain("private");
    expect(validateAttachmentUri("https://192.168.1.1/")).toContain("private");
    expect(validateAttachmentUri("https://169.254.169.254/")).toContain("private");
  });

  // --- IPv6 loopback ---
  test("rejects IPv6 loopback", () => {
    expect(validateAttachmentUri("https://[::1]/")).toContain("private");
  });

  // --- IPv6 private ranges ---
  test("rejects IPv6 link-local (fe80::)", () => {
    expect(validateAttachmentUri("https://[fe80::1]/")).toContain("private");
  });

  test("rejects IPv6 unique-local (fc00::/fd00::)", () => {
    expect(validateAttachmentUri("https://[fc00::1]/")).toContain("private");
    expect(validateAttachmentUri("https://[fd00::1]/")).toContain("private");
  });

  // --- IPv6-mapped IPv4 (S-9 SSRF bypass) ---
  test("rejects IPv6-mapped IPv4 loopback (::ffff:127.0.0.1)", () => {
    expect(validateAttachmentUri("https://[::ffff:127.0.0.1]/")).toContain("private");
  });

  test("rejects IPv6-mapped private IPv4 (::ffff:10.x.x.x)", () => {
    expect(validateAttachmentUri("https://[::ffff:10.0.0.1]/")).toContain("private");
    expect(validateAttachmentUri("https://[::ffff:192.168.1.1]/")).toContain("private");
    expect(validateAttachmentUri("https://[::ffff:169.254.169.254]/")).toContain("private");
  });

  test("allows IPv6-mapped public IPv4", () => {
    expect(validateAttachmentUri("https://[::ffff:8.8.8.8]/")).toBeNull();
  });
});
