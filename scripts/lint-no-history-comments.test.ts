/**
 * Tests for the history-comment guard.
 *
 * Verify each banned pattern fires in comment context, that string
 * literals containing the same words do NOT fire, and that the
 * per-line opt-out and JSDoc shapes work as expected.
 */
import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { commentBody, scanText } from "./lint-no-history-comments.ts";

// ── Pattern coverage ──────────────────────────────────────────────

test("catches 'originally' in a line comment", () => {
  const hits = scanText("// originally returned a string", "x.ts");
  expect(hits.length).toBe(1);
  expect(hits[0].pattern).toContain("originally");
});

test("catches 'formerly' in a JSDoc-style line", () => {
  const hits = scanText(" *  formerly known as buildFoo", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'previously' in a trailing comment", () => {
  const hits = scanText("const x = 1; // previously a string", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'historically' (case-insensitive)", () => {
  const hits = scanText("// Historically this was inlined", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'back when' phrase", () => {
  const hits = scanText("// back when oracle was a single instance", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'used to <verb>' pattern", () => {
  const hits = scanText("// this used to live in src/foo.ts", "x.ts");
  expect(hits.length).toBe(1);
  expect(hits[0].pattern).toContain("used to");
});

test("catches 'used to be' specifically", () => {
  const hits = scanText("// the field used to be a string", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'before the refactor'", () => {
  const hits = scanText("// before the refactor we did X", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'before this rewrite'", () => {
  const hits = scanText("// before this rewrite the function was huge", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'in the previous version'", () => {
  const hits = scanText("// in the previous version this was async", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'in the prior implementation'", () => {
  const hits = scanText("// in the prior implementation we polled", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'removed in favor of'", () => {
  const hits = scanText("// removed in favor of HKDF", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches 'removed in favour of' (UK spelling)", () => {
  const hits = scanText("// removed in favour of HKDF", "x.ts");
  expect(hits.length).toBe(1);
});

test("catches the original bun:test scenario", () => {
  const hits = scanText(
    "// The original bun:test version passed a 120_000 ms timeout",
    "x.ts",
  );
  expect(hits.length).toBe(1);
});

test("catches 'the original implementation'", () => {
  const hits = scanText(
    "// the original implementation polled every 5s",
    "x.ts",
  );
  expect(hits.length).toBe(1);
});

// ── False-positive avoidance ──────────────────────────────────────

test("does NOT flag 'no longer needed' in runtime-state context", () => {
  // "when the wallet is no longer needed" describes runtime, not
  // implementation history. We deliberately don't ban this phrase.
  const hits = scanText("// call when the wallet is no longer needed", "x.ts");
  expect(hits.length).toBe(0);
});

test("does NOT flag 'was deleted' in test-scenario context", () => {
  // "the secret was deleted" is a test step, not implementation history.
  const hits = scanText("// the secret was deleted before signing", "x.ts");
  expect(hits.length).toBe(0);
});

test("does NOT flag 'previously' inside a string literal", () => {
  const hits = scanText(
    'const msg = "previously authenticated"; // ok',
    "x.ts",
  );
  expect(hits.length).toBe(0);
});

test("does NOT flag 'used to' inside a string literal", () => {
  const hits = scanText('throw new Error("used to be valid");', "x.ts");
  expect(hits.length).toBe(0);
});

test("does NOT flag plain 'used to' followed by infinitive (current usage)", () => {
  // "X is used to authenticate Y" — current usage, not history. Our
  // regex requires a past-tense auxiliary after "used to", so a bare
  // infinitive ("authenticate") doesn't trigger.
  const hits = scanText("// X is used to authenticate the request", "x.ts");
  expect(hits.length).toBe(0);
});

test("does NOT flag identifier substrings", () => {
  const hits = scanText("const previouslySeen = new Set();", "x.ts");
  expect(hits.length).toBe(0);
});

test("does NOT flag URL-style '//' (not a comment delimiter)", () => {
  const hits = scanText('const u = "https://example.com/previously"; ', "x.ts");
  expect(hits.length).toBe(0);
});

test("does NOT flag identifier 'historicalRange'", () => {
  const hits = scanText("function historicalRange() { return 1; }", "x.ts");
  expect(hits.length).toBe(0);
});

// ── Opt-out ───────────────────────────────────────────────────────

test("ignores opt-out marker on same line", () => {
  const hits = scanText(
    "// previously stored as a Map — allow-history: spec-of-record example",
    "x.ts",
  );
  expect(hits.length).toBe(0);
});

test("opt-out only applies to its own line", () => {
  const text = [
    "// allow-history: scope marker",
    "// previously stored as a Map",
  ].join("\n");
  const hits = scanText(text, "x.ts");
  expect(hits.length).toBe(1);
  expect(hits[0].line).toBe(2);
});

test("opt-out requires a non-empty reason", () => {
  const hits = scanText("// previously a Map — allow-history:", "x.ts");
  expect(hits.length).toBe(1);
});

// ── commentBody helper ────────────────────────────────────────────

test("commentBody extracts // line comments", () => {
  expect(commentBody("// foo")).toBe(" foo");
});

test("commentBody extracts trailing comments", () => {
  expect(commentBody("const x = 1; // foo")).toBe(" foo");
});

test("commentBody extracts JSDoc continuation lines", () => {
  expect(commentBody(" *  foo")).toBe("  foo");
});

test("commentBody returns null when no comment", () => {
  expect(commentBody("const x = 1;")).toBe(null);
});

test("commentBody returns null when '//' is inside a string", () => {
  expect(commentBody('const u = "https://example.com";')).toBe(null);
});

// ── Repo-level scan ───────────────────────────────────────────────

test("repo-level scan passes on HEAD", async () => {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-run",
      "scripts/lint-no-history-comments.ts",
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
