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
    test("awaiting_offers -> provider_selected is valid", () => {
      expect(isValidTransition("awaiting_offers", "provider_selected", true))
        .toBe(true);
    });

    test("awaiting_offers -> processing is no longer valid (must go through provider_selected)", () => {
      expect(isValidTransition("awaiting_offers", "processing", true)).toBe(
        false,
      );
    });

    test("provider_selected -> processing is valid", () => {
      expect(isValidTransition("provider_selected", "processing", true)).toBe(
        true,
      );
    });

    test("provider_selected -> expired is valid", () => {
      expect(isValidTransition("provider_selected", "expired", true)).toBe(
        true,
      );
    });

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
