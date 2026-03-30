import { describe, test, expect } from "bun:test";
import { isSuspiciousRegex } from "./tlsn-validation";

describe("isSuspiciousRegex (ReDoS guard)", () => {
  // --- Should REJECT (catastrophic backtracking patterns) ---
  test("rejects (a+)+", () => {
    expect(isSuspiciousRegex("(a+)+")).toBe(true);
  });

  test("rejects (.*)+", () => {
    expect(isSuspiciousRegex("(.*)+")).toBe(true);
  });

  test("rejects (.+)*", () => {
    expect(isSuspiciousRegex("(.+)*")).toBe(true);
  });

  test("rejects (a{1,5})+", () => {
    expect(isSuspiciousRegex("(a{1,5})+")).toBe(true);
  });

  test("rejects alternation-based ReDoS (a|a)+", () => {
    expect(isSuspiciousRegex("(a|a)+")).toBe(true);
  });

  test("rejects (a|b)*+ pattern", () => {
    expect(isSuspiciousRegex("(a|b)*")).toBe(true);
  });

  test("rejects nested group ((a+))+", () => {
    expect(isSuspiciousRegex("((a+))+")).toBe(true);
  });

  test("rejects non-capturing group (?:a+)+", () => {
    expect(isSuspiciousRegex("(?:a+)+")).toBe(true);
  });

  // --- Should ALLOW (safe patterns) ---
  test("allows simple literal", () => {
    expect(isSuspiciousRegex("bitcoin")).toBe(false);
  });

  test("allows simple quantifier (no nesting)", () => {
    expect(isSuspiciousRegex("a+")).toBe(false);
  });

  test("allows character class with quantifier", () => {
    expect(isSuspiciousRegex("[a-z]+")).toBe(false);
  });

  test("allows group without inner quantifier", () => {
    expect(isSuspiciousRegex("(abc)+")).toBe(false);
  });

  test("allows non-quantified group with inner quantifier", () => {
    expect(isSuspiciousRegex("(a+)")).toBe(false);
  });

  test("allows typical price extraction regex", () => {
    expect(isSuspiciousRegex("\\d+\\.\\d{2}")).toBe(false);
  });

  test("allows character class that looks like group [+*]", () => {
    expect(isSuspiciousRegex("[+*]+")).toBe(false);
  });
});
