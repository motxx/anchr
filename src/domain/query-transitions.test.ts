import { test, expect, describe } from "bun:test";
import { isValidTransition, isCancellable, isExpirable, isTerminal } from "./query-transitions";
import type { QueryStatus } from "./types";

describe("isValidTransition", () => {
  // --- Simple (non-HTLC) valid transitions ---
  describe("Simple path", () => {
    test("pending → approved", () => {
      expect(isValidTransition("pending", "approved", false)).toBe(true);
    });
    test("pending → rejected", () => {
      expect(isValidTransition("pending", "rejected", false)).toBe(true);
    });
    test("pending → expired", () => {
      expect(isValidTransition("pending", "expired", false)).toBe(true);
    });
  });

  // --- Simple invalid transitions ---
  describe("Simple path — invalid", () => {
    test("pending → processing", () => {
      expect(isValidTransition("pending", "processing", false)).toBe(false);
    });
    test("pending → verifying", () => {
      expect(isValidTransition("pending", "verifying", false)).toBe(false);
    });
    test("pending → awaiting_quotes", () => {
      expect(isValidTransition("pending", "awaiting_quotes", false)).toBe(false);
    });
    test("approved → rejected", () => {
      expect(isValidTransition("approved", "rejected", false)).toBe(false);
    });
    test("rejected → approved", () => {
      expect(isValidTransition("rejected", "approved", false)).toBe(false);
    });
    test("expired → pending", () => {
      expect(isValidTransition("expired", "pending", false)).toBe(false);
    });
  });

  // --- HTLC valid transitions ---
  describe("HTLC path", () => {
    test("awaiting_quotes → processing", () => {
      expect(isValidTransition("awaiting_quotes", "processing", true)).toBe(true);
    });
    test("awaiting_quotes → expired", () => {
      expect(isValidTransition("awaiting_quotes", "expired", true)).toBe(true);
    });
    test("processing → verifying", () => {
      expect(isValidTransition("processing", "verifying", true)).toBe(true);
    });
    test("processing → expired", () => {
      expect(isValidTransition("processing", "expired", true)).toBe(true);
    });
    test("verifying → approved", () => {
      expect(isValidTransition("verifying", "approved", true)).toBe(true);
    });
    test("verifying → rejected", () => {
      expect(isValidTransition("verifying", "rejected", true)).toBe(true);
    });
  });

  // --- HTLC invalid transitions ---
  describe("HTLC path — invalid", () => {
    test("awaiting_quotes → approved", () => {
      expect(isValidTransition("awaiting_quotes", "approved", true)).toBe(false);
    });
    test("awaiting_quotes → rejected", () => {
      expect(isValidTransition("awaiting_quotes", "rejected", true)).toBe(false);
    });
    test("processing → approved", () => {
      expect(isValidTransition("processing", "approved", true)).toBe(false);
    });
    test("verifying → processing", () => {
      expect(isValidTransition("verifying", "processing", true)).toBe(false);
    });
    test("verifying → expired", () => {
      expect(isValidTransition("verifying", "expired", true)).toBe(false);
    });
  });

  // --- Terminal states ---
  describe("terminal states block all transitions", () => {
    const terminals: QueryStatus[] = ["approved", "rejected", "expired"];
    const targets: QueryStatus[] = ["pending", "awaiting_quotes", "processing", "verifying", "approved", "rejected", "expired"];

    for (const from of terminals) {
      for (const to of targets) {
        test(`${from} → ${to} (simple)`, () => {
          expect(isValidTransition(from, to, false)).toBe(false);
        });
        test(`${from} → ${to} (htlc)`, () => {
          expect(isValidTransition(from, to, true)).toBe(false);
        });
      }
    }
  });
});

describe("isCancellable", () => {
  test("pending is cancellable", () => {
    expect(isCancellable("pending")).toBe(true);
  });
  test("awaiting_quotes is cancellable", () => {
    expect(isCancellable("awaiting_quotes")).toBe(true);
  });
  test("worker_selected is cancellable", () => {
    expect(isCancellable("worker_selected")).toBe(true);
  });
  test("processing is cancellable", () => {
    expect(isCancellable("processing")).toBe(true);
  });
  test("verifying is not cancellable", () => {
    expect(isCancellable("verifying")).toBe(false);
  });
  test("approved is not cancellable", () => {
    expect(isCancellable("approved")).toBe(false);
  });
  test("rejected is not cancellable", () => {
    expect(isCancellable("rejected")).toBe(false);
  });
  test("expired is not cancellable", () => {
    expect(isCancellable("expired")).toBe(false);
  });
});

describe("isExpirable", () => {
  test("pending is expirable", () => {
    expect(isExpirable("pending")).toBe(true);
  });
  test("awaiting_quotes is expirable", () => {
    expect(isExpirable("awaiting_quotes")).toBe(true);
  });
  test("worker_selected is expirable", () => {
    expect(isExpirable("worker_selected")).toBe(true);
  });
  test("processing is expirable", () => {
    expect(isExpirable("processing")).toBe(true);
  });
  test("verifying is not expirable", () => {
    expect(isExpirable("verifying")).toBe(false);
  });
  test("approved is not expirable", () => {
    expect(isExpirable("approved")).toBe(false);
  });
  test("rejected is not expirable", () => {
    expect(isExpirable("rejected")).toBe(false);
  });
  test("expired is not expirable", () => {
    expect(isExpirable("expired")).toBe(false);
  });
});

describe("isTerminal", () => {
  test("approved is terminal", () => {
    expect(isTerminal("approved")).toBe(true);
  });
  test("rejected is terminal", () => {
    expect(isTerminal("rejected")).toBe(true);
  });
  test("expired is terminal", () => {
    expect(isTerminal("expired")).toBe(true);
  });
  test("pending is not terminal", () => {
    expect(isTerminal("pending")).toBe(false);
  });
  test("awaiting_quotes is not terminal", () => {
    expect(isTerminal("awaiting_quotes")).toBe(false);
  });
  test("processing is not terminal", () => {
    expect(isTerminal("processing")).toBe(false);
  });
  test("verifying is not terminal", () => {
    expect(isTerminal("verifying")).toBe(false);
  });
});
