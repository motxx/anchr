import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { shouldCheckFormat } from "./lint-fmt.ts";

test("checks TypeScript, JavaScript, and Deno config files", () => {
  expect(shouldCheckFormat("packages/core-runtime/src/mod.ts")).toBe(true);
  expect(shouldCheckFormat("examples/sdk-lesson/src/view.tsx")).toBe(true);
  expect(shouldCheckFormat("scripts/plugin/coingecko-btc.js")).toBe(true);
  expect(shouldCheckFormat("deno.json")).toBe(true);
  expect(shouldCheckFormat("packages/sdk/deno.json")).toBe(true);
});

test("excludes Markdown docs and non-Deno JSON artifacts", () => {
  expect(shouldCheckFormat("README.md")).toBe(false);
  expect(shouldCheckFormat("docs/architecture.md")).toBe(false);
  expect(shouldCheckFormat("docs/fixtures/deno.json")).toBe(false);
  expect(shouldCheckFormat("packages/sdk/package.json")).toBe(false);
  expect(shouldCheckFormat("scripts/package-lock.json")).toBe(false);
});

test("excludes generated or shared-agent directories", () => {
  expect(shouldCheckFormat("skills/test/SKILL.md")).toBe(false);
  expect(shouldCheckFormat(".claude/skills/test/SKILL.md")).toBe(false);
  expect(shouldCheckFormat(".codex/skills/test/SKILL.md")).toBe(false);
});
