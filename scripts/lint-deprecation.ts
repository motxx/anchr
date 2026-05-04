#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run
/**
 * Deprecation-vocabulary guard.
 *
 * Pre-1.0 (current state) the project ships no users, so there is nothing
 * to keep backward-compatible. Rather than carrying `@deprecated` aliases
 * and "legacy" code paths through refactors, we delete them outright and
 * lean on the test suite to catch regressions. This lint enforces that
 * discipline deterministically.
 *
 * Banned in source files (.ts / .tsx / .rs):
 *   - `@deprecated` JSDoc tag
 *   - the word "deprecated" (any case)
 *   - the word "legacy" (any case)
 *   - the phrase "backward(s) compat..." (any case, hyphen or space)
 *
 * Markdown is not scanned: specs and design docs may legitimately discuss
 * these concepts (e.g. when documenting the policy itself, or comparing
 * Anchr to systems that DO ship deprecation cycles).
 *
 * The opt-out is intentionally narrow. After 1.0 ships and SemVer kicks
 * in, `@deprecated since vX.Y, removed in vZ.0` notices are legitimate on
 * minor/patch boundaries — those lines must carry an explicit
 * `allow-deprecation-vocab: <reason>` marker so the human review surface
 * stays visible.
 *
 * Usage:
 *   deno task lint:deprecation                                       # scan repo
 *   deno run --allow-read scripts/lint-deprecation.ts <file>...      # scan files
 *   deno run --allow-read scripts/lint-deprecation.ts --stdin        # scan stdin
 *
 * Exit codes:
 *   0 = clean
 *   1 = violation detected
 *
 * Per-line opt-out (same line):
 *   allow-deprecation-vocab: <reason>
 */
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;

interface Hit {
  file: string;
  line: number;
  text: string;
  match: string;
  pattern: string;
}

// Banned vocabulary. Order matters only for the chosen "match" string —
// the first hit on a line wins. All four patterns are ASCII and use word
// boundaries to avoid matching unrelated substrings (e.g. "delegacy" is
// fine; "Legacy" is not).
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "@deprecated tag", re: /@deprecated\b/ },
  { name: "'deprecated' word", re: /\bdeprecated\b/i },
  { name: "'legacy' word", re: /\blegacy\b/i },
  { name: "'backward(s) compat' phrase", re: /\bbackwards?[\s_-]?compat/i },
];

// Only scan source files. Markdown, JSON, lockfiles, and configs are
// off-limits to avoid swamping the harness with false positives.
const SOURCE_EXTS = /\.(ts|tsx|rs)$/;

// Self-exemptions: files that must contain the vocabulary by their nature
// (this lint, its test, the SemVer policy doc if/when it lands as code).
const SELF_EXEMPT = new Set([
  "scripts/lint-deprecation.ts",
  "scripts/lint-deprecation.test.ts",
]);

const OPT_OUT = /allow-deprecation-vocab:/;

export function scanText(text: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (OPT_OUT.test(line)) continue;
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (m) {
        hits.push({
          file,
          line: i + 1,
          text: line.trim(),
          match: m[0],
          pattern: p.name,
        });
        break; // one hit per line is enough
      }
    }
  }
  return hits;
}

async function scanFile(path: string): Promise<Hit[]> {
  try {
    const text = await Deno.readTextFile(path);
    const rel = relative(ROOT, path) || path;
    if (SELF_EXEMPT.has(rel)) return [];
    return scanText(text, rel);
  } catch {
    return [];
  }
}

async function scanRepo(): Promise<Hit[]> {
  const cmd = new Deno.Command("git", {
    args: ["ls-files", "-z"],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr));
    throw new Error("git ls-files failed");
  }
  const names = new TextDecoder()
    .decode(stdout)
    .split("\0")
    .filter(Boolean)
    .filter((f) => SOURCE_EXTS.test(f));

  const hits: Hit[] = [];
  for (const name of names) {
    hits.push(...(await scanFile(`${ROOT}${name}`)));
  }
  return hits;
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(4096);
  while (true) {
    const n = await Deno.stdin.read(buf);
    if (n === null) break;
    chunks.push(buf.slice(0, n));
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(out);
}

function report(hits: Hit[]): void {
  if (hits.length === 0) {
    console.log("✓ no deprecation vocabulary detected");
    return;
  }
  console.error(`✗ deprecation vocabulary: ${hits.length} hit(s)\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  [${h.pattern}]  ${h.match}`);
    console.error(`      ${h.text}`);
  }
  console.error(
    "\nPolicy: pre-1.0 has no users — delete the path instead of marking it.\n" +
      "If a regression is the worry, add a test that locks the new behaviour.\n" +
      "If you genuinely need the word (e.g. post-1.0 SemVer notice), append\n" +
      '"allow-deprecation-vocab: <reason>" on the same line.',
  );
}

if (import.meta.main) {
  const args = Deno.args;
  let hits: Hit[] = [];
  if (args.includes("--stdin")) {
    const text = await readStdin();
    hits = scanText(text, "<stdin>");
  } else if (args.length > 0) {
    for (const f of args) hits.push(...(await scanFile(f)));
  } else {
    hits = await scanRepo();
  }
  report(hits);
  Deno.exit(hits.length === 0 ? 0 : 1);
}

export { PATTERNS };
