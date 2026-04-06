import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { isExpirable, isValidTransition } from "./query-transitions.ts";

describe("query-transitions", () => {
  describe("isExpirable", () => {
    test("verifying is expirable", () => {
      expect(isExpirable("verifying")).toBe(true);
    });

    test("pending is expirable", () => {
      expect(isExpirable("pending")).toBe(true);
    });

    test("approved is not expirable", () => {
      expect(isExpirable("approved")).toBe(false);
    });
  });

  describe("isValidTransition (HTLC)", () => {
    test("verifying -> expired is valid", () => {
      expect(isValidTransition("verifying", "expired", true)).toBe(true);
    });

    test("verifying -> approved is still valid", () => {
      expect(isValidTransition("verifying", "approved", true)).toBe(true);
    });

    test("verifying -> rejected is still valid", () => {
      expect(isValidTransition("verifying", "rejected", true)).toBe(true);
    });
  });
});
