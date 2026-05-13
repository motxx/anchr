import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { scanRepo, scanText } from "./lint-no-test-sanitizer-bypass.ts";

test("catches disabled op sanitizer", () => {
  const hits = scanText(
    `Deno.test("x", { sanitizeOps: false }, () => {});`,
    "sample.test.ts",
  );
  expect(hits).toEqual([
    {
      file: "sample.test.ts",
      line: 1,
      text: `Deno.test("x", { sanitizeOps: false }, () => {});`,
      option: "sanitizeOps",
    },
  ]);
});

test("catches disabled resource and exit sanitizers", () => {
  const hits = scanText(
    [
      `describe("x", { sanitizeResources: false }, () => {});`,
      `Deno.test({ name: "y", sanitizeExit: false, fn() {} });`,
    ].join("\n"),
    "sample.test.ts",
  );
  expect(hits.map((hit) => hit.option)).toEqual([
    "sanitizeResources",
    "sanitizeExit",
  ]);
});

test("allows enabled sanitizers and default sanitizer behavior", () => {
  const hits = scanText(
    [
      `Deno.test("x", () => {});`,
      `Deno.test({ name: "y", sanitizeOps: true, fn() {} });`,
      `Deno.test({ name: "z", sanitizeResources: someFlag, fn() {} });`,
    ].join("\n"),
    "sample.test.ts",
  );
  expect(hits).toEqual([]);
});

test("repository scan is clean", async () => {
  const hits = await scanRepo();
  expect(hits).toEqual([]);
});
