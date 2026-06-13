import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { validateAttachmentUri } from "./url-validation.ts";
import type { AttachmentRuntimeConfig } from "../internal/runtime/config.ts";

const defaultConfig: AttachmentRuntimeConfig = {
  publicBaseUrl: undefined,
  allowLocalhostAttachments: false,
  blossomServers: [],
};

const localhostConfig: AttachmentRuntimeConfig = {
  ...defaultConfig,
  allowLocalhostAttachments: true,
};

function validate(uri: string): string | null {
  return validateAttachmentUri(uri, { config: defaultConfig });
}

describe("validateAttachmentUri", () => {
  // --- Valid URLs ---
  test("accepts HTTPS URLs", () => {
    expect(validate("https://example.com/photo.jpg")).toBeNull();
    expect(validate("https://blossom.example.com/abc123")).toBeNull();
  });

  test("accepts http://localhost only with the explicit dev opt-in", () => {
    expect(validateAttachmentUri("http://localhost:3333/blob", {
      config: localhostConfig,
    })).toBeNull();
    expect(validateAttachmentUri("http://127.0.0.1:3333/blob", {
      config: localhostConfig,
    })).toBeNull();
  });

  test("rejects loopback by default (no opt-in env set)", () => {
    expect(validateAttachmentUri("http://localhost:3333/blob", {
      config: defaultConfig,
    })).toContain("localhost");
    expect(validateAttachmentUri("https://127.0.0.1/blob", {
      config: defaultConfig,
    })).toContain("localhost");
    expect(validateAttachmentUri("https://[::1]/blob", {
      config: defaultConfig,
    })).toContain("localhost");
    expect(validateAttachmentUri("https://[::ffff:127.0.0.1]/blob", {
      config: defaultConfig,
    })).toContain("localhost");
  });

  // --- Protocol ---
  test("rejects non-HTTPS for non-localhost", () => {
    expect(validate("http://evil.com/data")).toContain("HTTPS");
  });

  test("rejects non-HTTP protocols", () => {
    expect(validate("ftp://example.com/file")).toContain("HTTPS");
    expect(validate("file:///etc/passwd")).toContain("HTTPS");
    expect(validate("javascript:alert(1)")).not.toBeNull();
  });

  test("rejects invalid URLs", () => {
    expect(validate("not a url")).toContain("Invalid");
    expect(validate("")).toContain("Invalid");
  });

  // --- Embedded credentials ---
  test("rejects URLs with embedded credentials", () => {
    expect(validate("https://user:pass@example.com/")).toContain(
      "credentials",
    );
    expect(validate("https://admin@example.com/")).toContain(
      "credentials",
    );
  });

  // --- Private IPv4 ---
  test("rejects private IPv4 ranges", () => {
    expect(validate("https://10.0.0.1/")).toContain("private");
    expect(validate("https://172.16.0.1/")).toContain("private");
    expect(validate("https://192.168.1.1/")).toContain("private");
    expect(validate("https://169.254.169.254/")).toContain(
      "private",
    );
  });

  // --- IPv6 loopback ---
  test("rejects IPv6 loopback", () => {
    expect(validate("https://[::1]/")).toContain("localhost");
  });

  // --- IPv6 private ranges ---
  test("rejects IPv6 link-local (fe80::)", () => {
    expect(validate("https://[fe80::1]/")).toContain("private");
  });

  test("rejects IPv6 unique-local (fc00::/fd00::)", () => {
    expect(validate("https://[fc00::1]/")).toContain("private");
    expect(validate("https://[fd00::1]/")).toContain("private");
  });

  // --- IPv6-mapped IPv4 (S-9 SSRF bypass) ---
  test("rejects IPv6-mapped IPv4 loopback (::ffff:127.0.0.1)", () => {
    expect(validate("https://[::ffff:127.0.0.1]/")).toContain(
      "localhost",
    );
  });

  test("rejects IPv6-mapped private IPv4 (::ffff:10.x.x.x)", () => {
    expect(validate("https://[::ffff:10.0.0.1]/")).toContain(
      "private",
    );
    expect(validate("https://[::ffff:192.168.1.1]/")).toContain(
      "private",
    );
    expect(validate("https://[::ffff:169.254.169.254]/"))
      .toContain("private");
  });

  test("allows IPv6-mapped public IPv4", () => {
    expect(validate("https://[::ffff:8.8.8.8]/")).toBeNull();
  });
});
