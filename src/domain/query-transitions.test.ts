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
    test("awaiting_quotes -> worker_selected is valid", () => {
      expect(isValidTransition("awaiting_quotes", "worker_selected", true)).toBe(true);
    });

    test("awaiting_quotes -> processing is no longer valid (must go through worker_selected)", () => {
      expect(isValidTransition("awaiting_quotes", "processing", true)).toBe(false);
    });

    test("worker_selected -> processing is valid", () => {
      expect(isValidTransition("worker_selected", "processing", true)).toBe(true);
    });

    test("worker_selected -> expired is valid", () => {
      expect(isValidTransition("worker_selected", "expired", true)).toBe(true);
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
