/**
 * Unit tests for silent-bypass-verify command parsing.
 *
 * The diff-collection and hook I/O paths exercise git and the file
 * system; cover those with the integration smoke test in CI rather
 * than mocking. These tests pin the pure parser logic so changes to
 * the command-classification rules surface immediately.
 */
import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  commandSegments,
  extractHead,
  isShippingCommand,
} from "./silent-bypass-verify.ts";

test("commandSegments splits on && || ; and |", () => {
  expect(commandSegments("a && b || c ; d | e")).toEqual([
    "a",
    "b",
    "c",
    "d",
    "e",
  ]);
});

test("commandSegments handles a single command", () => {
  expect(commandSegments("git push origin main")).toEqual([
    "git push origin main",
  ]);
});

test("extractHead strips leading env-var assignments", () => {
  const r = extractHead("NODE_ENV=prod DEBUG=1 git push origin main");
  expect(r.head).toBe("git");
  expect(r.args).toEqual(["push", "origin", "main"]);
});

test("extractHead strips absolute path on the head", () => {
  const r = extractHead("/usr/local/bin/git push origin");
  expect(r.head).toBe("git");
  expect(r.args).toEqual(["push", "origin"]);
});

test("extractHead returns empty when only env assignments are present", () => {
  expect(extractHead("FOO=bar BAZ=qux")).toEqual({ head: "", args: [] });
});

// isShippingCommand: positive cases — a verb that ships the work
// out of the local workspace.

test("isShippingCommand: bare git push", () => {
  expect(isShippingCommand("git push")).toBe(true);
});

test("isShippingCommand: git push with args", () => {
  expect(isShippingCommand("git push origin main")).toBe(true);
});

test("isShippingCommand: env-prefixed git push", () => {
  expect(isShippingCommand("NODE_ENV=prod git push --force-with-lease")).toBe(
    true,
  );
});

test("isShippingCommand: compound 'cd repo && git push'", () => {
  expect(isShippingCommand("cd repo && git push origin main")).toBe(true);
});

test("isShippingCommand: gh pr create", () => {
  expect(isShippingCommand("gh pr create --fill")).toBe(true);
});

test("isShippingCommand: absolute-path git", () => {
  expect(isShippingCommand("/usr/bin/git push")).toBe(true);
});

// Negative cases — commands that stay local.

test("isShippingCommand: git status is not shipping", () => {
  expect(isShippingCommand("git status")).toBe(false);
});

test("isShippingCommand: git commit is not shipping", () => {
  expect(isShippingCommand("git commit -m 'wip'")).toBe(false);
});

test("isShippingCommand: ls is not shipping", () => {
  expect(isShippingCommand("ls -la")).toBe(false);
});

test("isShippingCommand: a string mentioning push but not invoking git", () => {
  expect(isShippingCommand("echo 'remember to git push'")).toBe(false);
});

test("isShippingCommand: gh issue create is not shipping", () => {
  // Only `gh pr ...` is treated as shipping; other gh subcommands stay local.
  expect(isShippingCommand("gh issue create --title foo")).toBe(false);
});
