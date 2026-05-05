#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run
/**
 * Dynamic-import guard.
 *
 * `await import(...)` defers module loading to runtime. It defeats static
 * analysis, breaks bundler tree-shaking, and frequently hides
 * circular-dependency workarounds or paths that bit-rot silently
 * (the importer compiles fine even if the target file is renamed).
 *
 * The CLAUDE.md policy is: no dynamic `await import(...)` anywhere — every
 * legitimate platform conditional or script-mode entry must explain itself
 * via a `// allow-dynamic-import: <reason>` comment on the same line.
 *
 * Banned in every `.ts` / `.tsx` file in the repo:
 *   - `await import(...)` expressions
 *
 * Auto-exempt (no opt-out comment needed):
 *   - Imports of `node:*` modules — the standard library is inherently
 *     platform-conditional; treating each call site as a violation just
 *     adds noise.
 *   - Lines inside an `if (import.meta.main) { ... }` block — script mode
 *     is the canonical lazy-load.
 *
 * Per-line opt-out (same line):
 *   allow-dynamic-import: <reason>
 *
 * Usage:
 *   deno task lint:no-dynamic-import                                       # scan repo
 *   deno run --allow-read scripts/lint-no-dynamic-import.ts <file>...      # scan files
 *   deno run --allow-read scripts/lint-no-dynamic-import.ts --stdin        # scan stdin
 *
 * Exit codes:
 *   0 = clean
 *   1 = violation detected
 */
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;

interface Hit {
  file: string;
  line: number;
  text: string;
}

const DYNAMIC_IMPORT = /\bawait\s+import\s*\(\s*(["'`])([^"'`]+)\1/;
const NODE_MODULE = /^node:/;
const OPT_OUT = /allow-dynamic-import:/;

const SOURCE_EXTS = /\.(ts|tsx)$/;

/**
 * Files this lint cannot meaningfully police because their content is
 * itself the regex-input fixture set. Adding per-line opt-outs to every
 * fixture would clutter the test for no benefit; entire-file exemption is
 * narrow and named.
 */
const SELF_EXEMPT = new Set([
  "scripts/lint-no-dynamic-import.ts",
  "scripts/lint-no-dynamic-import.test.ts",
]);

/**
 * Track whether each line is inside an `if (import.meta.main) { ... }` block.
 * Lightweight brace counter — handles nested blocks but not unusual layouts
 * (e.g. multi-line conditions). Good enough for the gate-style usage in this
 * codebase.
 */
function computeMainBlockMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let depth = 0;
  let active = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!active && /\bif\s*\(\s*import\.meta\.main\s*\)/.test(line)) {
      active = true;
      depth = 0;
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      mask[i] = true;
      if (depth <= 0) active = false;
      continue;
    }

    if (active) {
      mask[i] = true;
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth <= 0) {
            active = false;
            break;
          }
        }
      }
    }
  }
  return mask;
}

export function scanText(text: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");
  const mainMask = computeMainBlockMask(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(DYNAMIC_IMPORT);
    if (!m) continue;
    if (OPT_OUT.test(line)) continue;
    if (mainMask[i]) continue;
    const target = m[2];
    if (NODE_MODULE.test(target)) continue;

    hits.push({
      file,
      line: i + 1,
      text: line.trim(),
    });
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
    console.log("✓ no banned dynamic imports detected");
    return;
  }
  console.error(`✗ dynamic import: ${hits.length} hit(s)\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}`);
    console.error(`      ${h.text}`);
  }
  console.error(
    "\nPolicy: prefer static `import` declarations. Dynamic `await\n" +
      "import(...)` defeats static analysis and breaks bundler tree-shaking.\n" +
      "Convert the call to a top-of-file static import — or, if a genuine\n" +
      "platform conditional / script-mode entry / lazy-load is required,\n" +
      'append "allow-dynamic-import: <reason>" on the same line.\n' +
      "Auto-exempt patterns: `node:*` targets and lines inside\n" +
      "`if (import.meta.main) { ... }` blocks.",
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
