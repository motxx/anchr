/**
 * Tests for the local-path leak guard.
 *
 * These verify the regex catches real leaks and ignores false positives,
 * and that the whole-repo scan is currently clean on HEAD.
 */
import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { scanText } from "./check-no-local-paths.ts";

test("catches /Users/<name>/ paths", () => {
  const hits = scanText("see /Users/moti/dev/src/foo for details", "a.md");
  expect(hits.length).toBe(1);
  expect(hits[0].match).toContain("/Users/moti/");
});

test("catches /home/<name>/ paths", () => {
  const hits = scanText("exported /home/alice/project/out.txt", "a.md");
  expect(hits.length).toBe(1);
});

test("catches ~/.gstack/ style paths", () => {
  const hits = scanText("design doc at ~/.gstack/projects/foo/plan.md", "a.md");
  expect(hits.length).toBe(1);
  expect(hits[0].match).toContain("~/.gstack");
});

test("catches $HOME/ paths", () => {
  const hits = scanText("cp $HOME/key.pem /tmp/", "a.md");
  expect(hits.length).toBe(1);
});

test("catches /private/var/folders TMPDIR paths", () => {
  const hits = scanText("wrote /private/var/folders/xy/abc/out", "a.md");
  expect(hits.length).toBe(1);
});

test("ignores URLs with /users/ lowercase path segment", () => {
  const hits = scanText("see https://github.com/orgs/anchr/users/moti", "a.md");
  expect(hits.length).toBe(0);
});

test("ignores bare ~ without path", () => {
  const hits = scanText("use ~ to mean approximately, e.g. ~5 minutes", "a.md");
  expect(hits.length).toBe(0);
});

test("ignores lines with allow-local-path: marker", () => {
  const hits = scanText(
    "example: /Users/you/repo/file.ts  // allow-local-path: docs",
    "a.md",
  );
  expect(hits.length).toBe(0);
});

test("repo-level scan passes on HEAD", async () => {
  // Smoke test — import and run the repo scan directly. If this starts
  // failing, either a leak was committed or the lint is too aggressive.
  const mod = await import("./check-no-local-paths.ts");
  // We only export scanText, so replicate the repo walk at test time via
  // the binary. Simpler: shell out.
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-run",
      "scripts/check-no-local-paths.ts",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr));
  }
  expect(code).toBe(0);
  // touch mod so TS doesn't complain about unused import
  expect(typeof mod.scanText).toBe("function");
});
