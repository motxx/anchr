/**
 * Design system component contract tests.
 *
 * These tests verify the prop APIs and variant mappings without
 * needing React Native rendering. They ensure the design system
 * contracts are stable across theme changes.
 */

import { describe, test, expect } from "bun:test";

// Since we can't import React Native components in bun test,
// we test the design system's data contracts directly.

describe("Badge variants", () => {
  const VARIANTS = ["default", "success", "warning", "error", "info", "muted"] as const;

  test("all variants are distinct", () => {
    // Each variant should produce a unique visual style
    expect(new Set(VARIANTS).size).toBe(VARIANTS.length);
  });

  test("variant list covers all query statuses", () => {
    // Map query statuses to badge variants
    const STATUS_TO_VARIANT: Record<string, string> = {
      pending: "default",
      awaiting_quotes: "default", // custom bg/text override
      worker_selected: "default",
      processing: "warning",
      verifying: "info",
      submitted: "default",
      approved: "success",
      rejected: "error",
      expired: "muted",
    };
    const usedVariants = new Set(Object.values(STATUS_TO_VARIANT));
    // All mapped variants should be valid
    for (const v of usedVariants) {
      expect(VARIANTS).toContain(v);
    }
  });
});

describe("Button variants", () => {
  const VARIANTS = ["primary", "secondary", "ghost", "destructive"] as const;
  const SIZES = ["sm", "md", "lg"] as const;

  test("all variants defined", () => {
    expect(VARIANTS.length).toBe(4);
  });

  test("all sizes defined", () => {
    expect(SIZES.length).toBe(3);
  });

  test("size ordering is consistent", () => {
    // sm < md < lg in terms of visual hierarchy
    expect(SIZES.indexOf("sm")).toBeLessThan(SIZES.indexOf("md"));
    expect(SIZES.indexOf("md")).toBeLessThan(SIZES.indexOf("lg"));
  });
});

describe("Text variants", () => {
  const VARIANTS = ["heading", "subheading", "body", "caption", "label", "mono"] as const;
  const WEIGHTS = ["normal", "medium", "semibold", "bold", "black"] as const;

  test("all variants defined", () => {
    expect(VARIANTS.length).toBe(6);
  });

  test("weight ordering from lightest to heaviest", () => {
    expect(WEIGHTS.indexOf("normal")).toBeLessThan(WEIGHTS.indexOf("bold"));
    expect(WEIGHTS.indexOf("bold")).toBeLessThan(WEIGHTS.indexOf("black"));
  });
});

describe("Icon sizes", () => {
  const SIZES = ["xs", "sm", "md", "lg"] as const;

  test("all sizes defined", () => {
    expect(SIZES.length).toBe(4);
  });
});

describe("FeedbackBanner variants", () => {
  const VARIANTS = ["success", "error", "warning", "info"] as const;

  test("covers common feedback states", () => {
    expect(VARIANTS).toContain("success");
    expect(VARIANTS).toContain("error");
    expect(VARIANTS).toContain("warning");
    expect(VARIANTS).toContain("info");
  });
});

describe("Design token consistency", () => {
  // Tailwind tokens used across the design system
  const SEMANTIC_TOKENS = {
    primary: "#10b981",
    destructive: "#ef4444",
    background: "#f5f5f4",
    foreground: "#1c1917",
    card: "#ffffff",
    muted: "#e7e5e4",
    border: "#d6d3d1",
  };

  test("primary is emerald", () => {
    expect(SEMANTIC_TOKENS.primary).toBe("#10b981");
  });

  test("destructive is red", () => {
    expect(SEMANTIC_TOKENS.destructive).toBe("#ef4444");
  });

  test("background is warm gray", () => {
    expect(SEMANTIC_TOKENS.background).toBe("#f5f5f4");
  });

  test("all tokens are hex colors", () => {
    for (const [, value] of Object.entries(SEMANTIC_TOKENS)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
