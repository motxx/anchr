#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run
/**
 * History-comment guard.
 *
 * Bans comments that explain what the code "used to" do — narratives
 * about a past implementation that no longer exists in the current
 * source. Such comments rot the moment the next refactor lands and
 * encode information that belongs in the commit message and the PR
 * description, not in the code that ships.
 *
 * Banned vocabulary (case-insensitive, comment context only):
 *   - originally / formerly / previously / historically / "back when"
 *   - "used to <past-verb>"  (e.g. "used to be", "used to live in")
 *   - "before the/this/our/a {refactor|rewrite|migration|rename|...}"
 *   - "in the (prior|previous|earlier|original) {version|impl|commit|PR|...}"
 *   - "the (original|prior|previous|earlier) [<word>] {version|impl|design|...}"
 *   - "removed in favour of" / "removed in favor of"
 *
 * Deliberately NOT banned (too noisy — overlap with current-state /
 * runtime / test-scenario descriptions):
 *   - "no longer X"       — often "when the X is no longer needed" (runtime)
 *   - "(was|were) <verb>" — often a test scenario step ("the secret was deleted")
 *
 * Markdown is not scanned: README / spec / SKILL files legitimately
 * discuss the journey from a previous design to the current one.
 *
 * Per-line opt-out (same line):
 *   `allow-history: <reason>`
 *
 * Reserved for cases where the historical narrative is genuinely
 * load-bearing for understanding the current code (rare).
 *
 * Usage:
 *   deno task lint:no-history-comments                                  # scan repo
 *   deno run --allow-read scripts/lint-no-history-comments.ts <file>    # scan files
 *   deno run --allow-read scripts/lint-no-history-comments.ts --stdin   # scan stdin
 *
 * Exit codes: 0 clean, 1 violation.
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

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "'originally'", re: /\boriginally\b/i },
  { name: "'formerly'", re: /\bformerly\b/i },
  { name: "'previously'", re: /\bpreviously\b/i },
  { name: "'historically'", re: /\bhistorically\b/i },
  { name: "'back when'", re: /\bback when\b/i },
  {
    name: "'used to <past-verb>'",
    re:
      /\bused to (be|was|were|use|used|live|reside|hold|return|returned|work|worked|exist|existed|sit|sat|do|did|have|had|fire|fired|throw|threw|wrap|wrapped|delegate|delegated|invoke|invoked|emit|emitted|store|stored|read|wrote|own|owned|contain|contained|include|included)\b/i,
  },
  {
    name: "'before the/this/... <refactor-verb>'",
    re:
      /\bbefore (the|this|my|a|an|our|previous|prior) (refactor|rewrite|migration|rename|extraction|cleanup|introduction|split|switch|removal|move)\b/i,
  },
  {
    name: "'in the (prior|previous|earlier|original) ...'",
    re:
      /\bin (the )?(prior|previous|earlier|original) (version|implementation|commit|pr|design|code|iteration|approach|build|state|impl|refactor)\b/i,
  },
  {
    name: "'the (original|prior|previous|earlier) [<word>] <impl-noun>'",
    re:
      /\bthe (original|prior|previous|earlier)( [\w:.@/-]+)? (version|implementation|design|code|approach|impl|test|file|module|name|api|behaviou?r|signature|commit|pr|iteration|build|refactor)\b/i,
  },
  { name: "'removed in favour of'", re: /\bremoved in favou?r of\b/i },
];

// Scan source code only. Markdown / JSON / lockfiles / configs are
// excluded — design docs and READMEs legitimately tell the journey.
const SOURCE_EXTS = /\.(ts|tsx|rs)$/;

const SELF_EXEMPT = new Set([
  "scripts/lint-no-history-comments.ts",
  "scripts/lint-no-history-comments.test.ts",
]);

const OPT_OUT = /allow-history:\s*\S/;

/**
 * Reduce a source line to its comment text only. Returns the comment
 * body (with the `//` or `/*` markers stripped) or `null` when the
 * line carries no comment. We care about a few shapes:
 *   - `// foo`              → "foo"
 *   - `/* foo *\/`          → "foo"
 *   - `*  foo`  (JSDoc)     → "foo"
 *   - `code // trailing`    → "trailing"
 * For block comments that span multiple lines, each interior line is
 * scanned; the leading `*` is stripped first.
 */
function commentBody(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.startsWith("//")) return trimmed.slice(2);
  if (trimmed.startsWith("/*")) return trimmed.slice(2).replace(/\*\/\s*$/, "");
  if (trimmed.startsWith("*")) return trimmed.slice(1);
  const idx = line.indexOf("//");
  if (idx === -1) return null;
  // Heuristic: ignore "//" that lives inside a string. The string
  // shapes that matter here are double-quoted, single-quoted, and
  // template literals. A precise lexer would be safer; this rough
  // check is good enough for the patterns we look for, which never
  // appear inside URL paths or import specifiers.
  const before = line.slice(0, idx);
  if (
    countUnescaped(before, '"') % 2 === 1 ||
    countUnescaped(before, "'") % 2 === 1 ||
    countUnescaped(before, "`") % 2 === 1
  ) {
    return null;
  }
  return line.slice(idx + 2);
}

function countUnescaped(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch && s[i - 1] !== "\\") n++;
  }
  return n;
}

export function scanText(text: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (OPT_OUT.test(line)) continue;
    const body = commentBody(line);
    if (body == null) continue;
    for (const p of PATTERNS) {
      const m = body.match(p.re);
      if (m) {
        hits.push({
          file,
          line: i + 1,
          text: line.trim(),
          match: m[0],
          pattern: p.name,
        });
        break; // one hit per line
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
    console.log("✓ no history-narrative comments detected");
    return;
  }
  console.error(`✗ history comments: ${hits.length} hit(s)\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  [${h.pattern}]  ${h.match}`);
    console.error(`      ${h.text}`);
  }
  console.error(
    "\nPolicy: comments that narrate what the code USED to do rot the\n" +
      "moment the next refactor lands. Delete the comment; if the why\n" +
      "behind the change matters, put it in the commit message and the\n" +
      "PR description (those don't live in the source). For the rare\n" +
      'genuinely load-bearing case, append "allow-history: <reason>"\n' +
      "on the same line.",
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

export { commentBody, PATTERNS };
