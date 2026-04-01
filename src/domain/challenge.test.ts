import { test, describe } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateNonce, buildChallengeRule } from "./challenge";

describe("generateNonce", () => {
  test("returns string of default length 6", () => {
    const nonce = generateNonce();
    expect(nonce.length).toBe(6);
  });

  test("respects custom length", () => {
    expect(generateNonce(10).length).toBe(10);
    expect(generateNonce(1).length).toBe(1);
  });

  test("contains only unambiguous characters", () => {
    const allowed = "ABCDEFGHJKLMNPQRTUVWXY2346789";
    for (let i = 0; i < 100; i++) {
      const nonce = generateNonce();
      for (const ch of nonce) {
        expect(allowed).toContain(ch);
      }
    }
  });

  test("generates different values (not constant)", () => {
    const nonces = new Set(Array.from({ length: 20 }, () => generateNonce()));
    // With 29^6 possible values, collisions in 20 draws are extremely unlikely
    expect(nonces.size).toBeGreaterThan(15);
  });
});

describe("buildChallengeRule", () => {
  test("includes nonce and description when nonce provided", () => {
    const rule = buildChallengeRule("ABC123", "東京タワー");
    expect(rule).toContain("ABC123");
    expect(rule).toContain("東京タワー");
    expect(rule).toContain("手書き");
  });

  test("omits nonce instruction when nonce is undefined", () => {
    const rule = buildChallengeRule(undefined, "東京タワー");
    expect(rule).toContain("東京タワー");
    expect(rule).not.toContain("手書き");
    expect(rule).toContain("撮影");
  });

  test("recommends C2PA camera", () => {
    expect(buildChallengeRule("X", "test")).toContain("C2PA");
    expect(buildChallengeRule(undefined, "test")).toContain("C2PA");
  });
});
