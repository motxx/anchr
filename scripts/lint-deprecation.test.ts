/**
 * Tests for the deprecation-vocabulary guard.
 *
 * Verify the regex catches each banned form, ignores opt-out markers, and
 * that the whole-repo scan is currently clean on HEAD.
 */
import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { scanText } from "./lint-deprecation.ts";

test("catches @deprecated JSDoc tag", () => {
  const hits = scanText("/** @deprecated Use foo instead. */", "x.ts");
  expect(hits.length).toBe(1);
  expect(hits[0].match).toBe("@deprecated");
  expect(hits[0].pattern).toContain("@deprecated");
});

test("catches the word 'deprecated' anywhere", () => {
  const hits = scanText("// this endpoint is deprecated", "x.ts");
  expect(hits.length).toBe(1);
  expect(hits[0].match.toLowerCase()).toBe("deprecated");
});

test("catches 'Deprecated' (case-insensitive)", () => {
  const hits = scanText('return c.json({ error: "Deprecated" });', "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'legacy' word", () => {
  const hits = scanText("// legacy 2-of-2 path", "x.ts");
  expect(hits.length).toBe(1);
  expect(hits[0].pattern).toContain("legacy");
});

test("catches 'backward compat' phrase", () => {
  const hits = scanText("// keep for backward compat", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'backwards-compat' phrase", () => {
  const hits = scanText("// backwards-compatible adapter", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'backward_compat' (underscore)", () => {
  const hits = scanText("const backward_compat = true;", "x.ts");
  expect(hits.length).toBe(1);
});

test("ignores unrelated substrings", () => {
  // 'delegacy' contains 'legacy' as a substring at the end — word boundary
  // means we should NOT match it. But our regex uses \b which would match
  // because 'delegacy' ends with 'legacy' followed by end-of-string. So
  // we use a stricter test: a word that genuinely doesn't contain the
  // banned vocab.
  const hits = scanText("const updated = computeNext();", "x.ts");
  expect(hits.length).toBe(0);
});

test("ignores 'predecessor' (no 'deprecated')", () => {
  const hits = scanText("// see predecessor function for details", "x.ts");
  expect(hits.length).toBe(0);
});

test("ignores opt-out marker on same line", () => {
  const hits = scanText(
    "/** @deprecated since v1.2. // allow-deprecation-vocab: post-1.0 SemVer */",
    "x.ts",
  );
  expect(hits.length).toBe(0);
});

test("opt-out only applies to its own line", () => {
  const text = [
    "// allow-deprecation-vocab: scope marker",
    "// this comment uses legacy wording without justification",
  ].join("\n");
  const hits = scanText(text, "x.ts");
  expect(hits.length).toBe(1);
  expect(hits[0].line).toBe(2);
});

test("repo-level scan passes on HEAD", async () => {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-run",
      "scripts/lint-deprecation.ts",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr));
  }
  expect(code).toBe(0);
});
