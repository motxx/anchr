import { test, describe } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { validateNoCredentials, SENSITIVE_HEADER_NAMES } from "./proof-redaction.ts";

describe("SENSITIVE_HEADER_NAMES", () => {
  test("includes standard auth headers", () => {
    expect(SENSITIVE_HEADER_NAMES).toContain("authorization");
    expect(SENSITIVE_HEADER_NAMES).toContain("cookie");
    expect(SENSITIVE_HEADER_NAMES).toContain("x-api-key");
  });
});

describe("validateNoCredentials", () => {
  test("detects Bearer token", () => {
    const text = "X-Custom: Bearer eyJhbGciOiJIUzI1NiJ9.test";
    const error = validateNoCredentials(text);
    expect(error).not.toBeNull();
  });

  test("detects Basic auth", () => {
    const text = "X-Custom: Basic dXNlcjpwYXNz";
    const error = validateNoCredentials(text);
    expect(error).not.toBeNull();
  });

  test("detects api_key pattern", () => {
    const text = "api_key=sk_live_abc123";
    const error = validateNoCredentials(text);
    expect(error).not.toBeNull();
  });

  test("passes clean headers", () => {
    const text = "Content-Type: application/json\nHost: example.com";
    const error = validateNoCredentials(text);
    expect(error).toBeNull();
  });

  test("passes [REDACTED] markers (from TLSNotary selective disclosure)", () => {
    const text = "GET /api/data HTTP/1.1\r\nHost: example.com\r\nAuthorization: [REDACTED]";
    const error = validateNoCredentials(text);
    expect(error).toBeNull();
  });
});
