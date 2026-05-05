/**
 * Tests for the dynamic-import guard.
 *
 * Verify the regex catches `await import(...)` in source, that auto-exempt
 * patterns (node:* targets, `if (import.meta.main)` blocks) are honoured,
 * and that the per-line opt-out works.
 */
import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { scanText } from "./lint-no-dynamic-import.ts";

test("catches plain `await import(...)` with relative path", () => {
  const hits = scanText(`const x = await import("./foo.ts");`, "src/a.ts");
  expect(hits.length).toBe(1);
});

test("catches `await import(...)` inside async block", () => {
  const text = [
    "async function load() {",
    `  const { foo } = await import("./foo.ts");`,
    "}",
  ].join("\n");
  const hits = scanText(text, "src/a.ts");
  expect(hits.length).toBe(1);
  expect(hits[0].line).toBe(2);
});

test("auto-exempts node:* module targets", () => {
  const text = [
    `const { copyFile } = await import("node:fs/promises");`,
    `const { tmpdir } = await import("node:os");`,
    `const { join } = await import("node:path");`,
  ].join("\n");
  const hits = scanText(text, "src/a.ts");
  expect(hits.length).toBe(0);
});

test("auto-exempts lines inside `if (import.meta.main) { ... }` block", () => {
  const text = [
    `import { app } from "./app.ts";`,
    "",
    "if (import.meta.main) {",
    `  await import("./server.ts");`,
    "}",
  ].join("\n");
  const hits = scanText(text, "src/index.ts");
  expect(hits.length).toBe(0);
});

test("does NOT exempt lines after the import.meta.main block closes", () => {
  const text = [
    "if (import.meta.main) {",
    `  await import("./allowed.ts");`,
    "}",
    "",
    `await import("./forbidden.ts");`,
  ].join("\n");
  const hits = scanText(text, "src/index.ts");
  expect(hits.length).toBe(1);
  expect(hits[0].line).toBe(5);
});

test("honours per-line `allow-dynamic-import:` opt-out", () => {
  const text = `const m = await import("./mod.ts"); // allow-dynamic-import: cycle-break for X`;
  const hits = scanText(text, "src/a.ts");
  expect(hits.length).toBe(0);
});

test("opt-out without reason still exempts (matches the marker)", () => {
  const text = `const m = await import("./mod.ts"); // allow-dynamic-import:`;
  const hits = scanText(text, "src/a.ts");
  expect(hits.length).toBe(0);
});

test("ignores unrelated `import` keyword usage", () => {
  const text = [
    `import { foo } from "./foo.ts";`,
    `import type { Bar } from "./bar.ts";`,
    `console.log(import.meta.url);`,
  ].join("\n");
  const hits = scanText(text, "src/a.ts");
  expect(hits.length).toBe(0);
});

test("catches package-target dynamic imports (jsr / npm aliases)", () => {
  const text = [
    `const { sha256 } = await import("@noble/hashes/sha2.js");`,
    `const lib = await import("npm:some-package");`,
  ].join("\n");
  const hits = scanText(text, "src/a.ts");
  expect(hits.length).toBe(2);
});

test("matches when there are extra spaces between await/import/paren", () => {
  const text = `const m = await   import  (  "./mod.ts"  );`;
  const hits = scanText(text, "src/a.ts");
  expect(hits.length).toBe(1);
});
