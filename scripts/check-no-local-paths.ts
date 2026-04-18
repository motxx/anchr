#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run
/**
 * Local-path leak guard.
 *
 * Catches accidentally-committed or about-to-be-posted local filesystem paths
 * (e.g. user-home absolute paths, tilde dirs, $HOME) that shouldn't escape
 * the developer's machine. The harness exists because a local design-doc
 * path made it into a PR body (see PR #51); this lint closes that hole.
 *
 * The repo scan uses `git ls-files` so gitignored files (node_modules, Pods,
 * local settings) are skipped automatically.
 *
 * Usage:
 *   deno task lint:paths                                             # scan repo
 *   deno run --allow-read scripts/check-no-local-paths.ts <file>...  # scan files
 *   deno run --allow-read scripts/check-no-local-paths.ts --stdin    # scan stdin
 *
 * Exit codes:
 *   0 = clean
 *   1 = leak detected
 *
 * Opt-out (same line):
 *   allow-local-path: <reason>
 */
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;

interface Hit {
  file: string;
  line: number;
  text: string;
  match: string;
}

// Patterns that indicate a developer-machine-specific path.
// Tuned conservatively to minimize false positives:
//   - /Users/<name>/  and /home/<name>/  — concrete user homes
//   - /private/var/folders/  — macOS per-user TMPDIR
//   - ~/  only when it looks like a path (followed by . or a word char then /)
//   - $HOME/  when followed by a path segment
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "macOS user home", re: /\/Users\/[a-zA-Z0-9._-]+\// },
  { name: "Linux user home", re: /\/home\/[a-zA-Z0-9._-]+\// },
  { name: "macOS TMPDIR", re: /\/private\/var\/folders\// },
  // ~/<word>/ or ~/.<word>  — tilde-expanded path
  { name: "tilde home path", re: /(?:^|[\s"'`(=])~\/[.\w][\w.-]*/ },
  { name: "$HOME path", re: /\$HOME\/[\w.-]+/ },
];

// Only scan text-like extensions when walking git-tracked files.
const TEXT_EXTS = /\.(ts|tsx|js|jsx|json|md|rs|sh|yml|yaml|toml|html|css)$/;

// Files that legitimately contain pattern strings (this script + its test +
// this harness's own regex fixtures + the gh-safe-body wrapper that mentions
// the original leak as motivation). Self-exemption avoids bootstrap issues.
const SELF_EXEMPT = new Set([
  "scripts/check-no-local-paths.ts",
  "scripts/check-no-local-paths.test.ts",
  "scripts/gh-safe-body.sh",
]);

const OPT_OUT = /allow-local-path:/;

function scanText(text: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (OPT_OUT.test(line)) continue;
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (m) {
        hits.push({ file, line: i + 1, text: line.trim(), match: m[0].trim() });
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
  // Only scan git-tracked files. Gitignored content (node_modules, Pods,
  // .claude/worktrees/, local mcp.json, etc.) is developer-local by design
  // and would produce false positives.
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
    .filter((f) => TEXT_EXTS.test(f));

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
    console.log("✓ no local paths detected");
    return;
  }
  console.error(`✗ local path leak: ${hits.length} hit(s)\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.match}`);
    console.error(`      ${h.text}`);
  }
  console.error(
    "\nFix: remove the path, or if it's legitimate content, append " +
      '"allow-local-path: <reason>" on the same line.',
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

export { scanText, PATTERNS };
