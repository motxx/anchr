/**
 * Unit tests for arch-lint-llm-verify command parsing.
 * Mirrors silent-bypass-verify.test.ts; the parser logic is shared in
 * shape (different scope / threshold constants).
 */
import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  commandSegments,
  extractHead,
  isShippingCommand,
} from "./arch-lint-llm-verify.ts";

test("commandSegments splits on && || ; and |", () => {
  expect(commandSegments("a && b || c ; d | e")).toEqual([
    "a",
    "b",
    "c",
    "d",
    "e",
  ]);
});

test("extractHead strips leading env-var assignments", () => {
  const r = extractHead("NODE_ENV=prod git push origin main");
  expect(r.head).toBe("git");
  expect(r.args).toEqual(["push", "origin", "main"]);
});

test("isShippingCommand: bare git push", () => {
  expect(isShippingCommand("git push")).toBe(true);
});

test("isShippingCommand: env-prefixed git push", () => {
  expect(isShippingCommand("CI=1 git push --tags")).toBe(true);
});

test("isShippingCommand: compound 'cd repo && git push'", () => {
  expect(isShippingCommand("cd repo && git push origin main")).toBe(true);
});

test("isShippingCommand: gh pr create", () => {
  expect(isShippingCommand("gh pr create --fill")).toBe(true);
});

test("isShippingCommand: git status is not shipping", () => {
  expect(isShippingCommand("git status")).toBe(false);
});

test("isShippingCommand: git commit is not shipping", () => {
  expect(isShippingCommand("git commit -m 'wip'")).toBe(false);
});

test("isShippingCommand: a string mentioning push but not invoking git", () => {
  expect(isShippingCommand("echo 'remember to git push'")).toBe(false);
});
