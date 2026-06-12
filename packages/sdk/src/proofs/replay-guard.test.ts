import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createReplayGuard } from "./replay-guard.ts";

describe("createReplayGuard", () => {
  test("remembers added keys within retention", () => {
    const guard = createReplayGuard({ now: () => 1000 });
    guard.add("a");
    expect(guard.has("a")).toBe(true);
    expect(guard.has("b")).toBe(false);
  });

  test("evicts entries older than retention", () => {
    let t = 0;
    const guard = createReplayGuard({ retentionMs: 100, now: () => t });
    guard.add("a");
    t = 50;
    guard.add("b");
    t = 120; // "a" is now 120ms old (> 100), "b" is 70ms old
    expect(guard.has("a")).toBe(false);
    expect(guard.has("b")).toBe(true);
    expect(guard.size()).toBe(1);
  });

  test("caps the number of remembered entries, evicting oldest first", () => {
    let t = 0;
    const guard = createReplayGuard({ maxEntries: 3, now: () => t++ });
    guard.add("a");
    guard.add("b");
    guard.add("c");
    guard.add("d");
    expect(guard.size()).toBe(3);
    expect(guard.has("a")).toBe(false);
    expect(guard.has("b")).toBe(true);
    expect(guard.has("d")).toBe(true);
  });

  test("clear empties the guard", () => {
    const guard = createReplayGuard({ now: () => 0 });
    guard.add("a");
    guard.clear();
    expect(guard.size()).toBe(0);
    expect(guard.has("a")).toBe(false);
  });
});
