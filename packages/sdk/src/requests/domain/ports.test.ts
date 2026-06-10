import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createDefaultIdGenerator } from "./ports.ts";

test("default id generator produces unique identifiers", () => {
  const generator = createDefaultIdGenerator();
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) ids.add(generator.newQueryId());
  expect(ids.size).toBe(50);
});

test("default id generator follows the documented shape", () => {
  const generator = createDefaultIdGenerator();
  expect(generator.newQueryId()).toMatch(/^query_\d+_[0-9a-f]{16}$/);
});
