import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateNonce } from "./challenge.ts";

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
