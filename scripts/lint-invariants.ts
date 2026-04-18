#!/usr/bin/env -S deno run --allow-read
/**
 * Invariant Lint — enforces threat-model ↔ test drift detection.
 *
 * Rules:
 *   [I001] Every INV-NN declared in docs/threat-model.md must have at least
 *          one matching test (TS `test("INV-NN: ...")` or Rust `fn inv_NN_*`
 *          or `// INV-NN` metadata comment). Exception: invariants with
 *          `**Status:** tests-pending-PR-N` are allowed zero tests.
 *   [I002] Every INV-NN referenced by a test must be declared in threat-model.md.
 *   [I003] Every INV-NN in threat-model.md must have a matching entry in
 *          docs/threat-model.lock.json with a hash that matches the current
 *          body. Mismatch = drift, must bump hash + add justification.
 *   [I004] Every INV-NN in lock.json must be declared in threat-model.md.
 *
 * Usage:
 *   deno task lint:invariants
 */
import { walk } from "jsr:@std/fs@^1/walk";
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;
const THREAT_MODEL = `${ROOT}docs/threat-model.md`;
const LOCK_FILE = `${ROOT}docs/threat-model.lock.json`;

interface Violation {
  code: string;
  message: string;
  file?: string;
  line?: number;
}

interface Invariant {
  id: string; // "INV-01"
  body: string; // text between heading and next heading
  status: "enforced" | "cross-referenced" | "tests-pending";
  pendingPR?: string; // e.g. "PR-2"
  startLine: number;
}

interface LockEntry {
  hash: string;
  justification: string;
}

// ── Markdown parsing (fence-aware) ─────────────────────────────────

/**
 * Parse `### INV-NN:` headings from threat-model.md. Skip matches inside
 * fenced code blocks (``` ... ```).
 */
function parseInvariants(md: string): Invariant[] {
  const lines = md.split("\n");
  const invs: Invariant[] = [];
  let inFence = false;
  let cur: Invariant | null = null;
  const bodyLines: string[] = [];

  const flush = () => {
    if (cur) {
      cur.body = bodyLines.join("\n").trim();
      cur.status = detectStatus(cur.body);
      cur.pendingPR = detectPendingPR(cur.body);
      invs.push(cur);
    }
    cur = null;
    bodyLines.length = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      inFence = !inFence;
      if (cur) bodyLines.push(line);
      continue;
    }
    if (inFence) {
      if (cur) bodyLines.push(line);
      continue;
    }
    const m = line.match(/^### (INV-\d+):/);
    if (m) {
      flush();
      cur = { id: m[1], body: "", status: "enforced", startLine: i + 1 };
      continue;
    }
    // Heading at same or higher level ends the invariant block.
    if (/^## /.test(line) || /^### /.test(line)) {
      flush();
      continue;
    }
    if (cur) bodyLines.push(line);
  }
  flush();
  return invs;
}

function detectStatus(body: string): Invariant["status"] {
  const m = body.match(/\*\*Status:\*\*\s+`?([a-z-]+)(?:-PR-\d+)?`?/i);
  if (!m) return "enforced";
  const raw = m[1].toLowerCase();
  if (raw.startsWith("tests-pending")) return "tests-pending";
  if (raw === "cross-referenced") return "cross-referenced";
  return "enforced";
}

function detectPendingPR(body: string): string | undefined {
  const m = body.match(/\*\*Status:\*\*\s+`?tests-pending-(PR-\d+)`?/i);
  return m ? m[1] : undefined;
}

// ── Test reference collection ──────────────────────────────────────

/**
 * Walk the repo for test files and collect every INV-NN reference.
 * Matches:
 *   - TS: test("INV-NN: ...", ...)
 *   - TS/JS: // INV-NN  (line comment metadata)
 *   - Rust: fn inv_NN_*() or // INV-NN in .rs files
 * Skips node_modules, dist, target, .git.
 */
async function collectTestReferences(): Promise<Map<string, Array<{ file: string; line: number }>>> {
  const refs = new Map<string, Array<{ file: string; line: number }>>();
  const add = (id: string, file: string, line: number) => {
    if (!refs.has(id)) refs.set(id, []);
    refs.get(id)!.push({ file, line });
  };

  const exts = [".ts", ".tsx", ".rs"];
  const skip = /\/(node_modules|dist|target|\.git|vendor)\//;

  for await (const entry of walk(ROOT, { includeDirs: false, exts })) {
    if (skip.test(entry.path)) continue;
    // Skip threat-model.md itself and the lint script.
    if (entry.path.endsWith("lint-invariants.ts")) continue;
    if (entry.path.endsWith("lint-invariants.test.ts")) {
      // The lint's own test file contains INV-NN strings as regex fixtures
      // (e.g., INV-99 to assert false-positive behavior). Skip it so the
      // self-test doesn't poison the cross-reference check.
      continue;
    }
    let content: string;
    try {
      content = await Deno.readTextFile(entry.path);
    } catch {
      continue;
    }
    const lines = content.split("\n");
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      // Track /* ... */ block comments (only affects match suppression for
      // Rust doc-comments; we still treat // INV-NN as valid metadata).
      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false;
        continue;
      }
      if (line.includes("/*") && !line.includes("*/")) {
        inBlockComment = true;
      }
      // Pattern 1: test("INV-NN: ...") — TS test annotation.
      const testMatches = line.matchAll(/test\(\s*["'`](INV-\d+):/g);
      for (const m of testMatches) add(m[1], entry.path, i + 1);

      // Pattern 2: // INV-NN  — metadata comment.
      const metaMatches = line.matchAll(/\/\/\s*(INV-\d+)\b/g);
      for (const m of metaMatches) add(m[1], entry.path, i + 1);

      // Pattern 3: fn inv_NN_*() — Rust test function.
      const rustMatches = line.matchAll(/fn\s+inv_(\d+)_/g);
      for (const m of rustMatches) {
        const id = `INV-${m[1].padStart(2, "0")}`;
        add(id, entry.path, i + 1);
      }
    }
  }
  return refs;
}

// ── Lock-file check ────────────────────────────────────────────────

async function computeBodyHash(body: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

async function loadLock(): Promise<Record<string, LockEntry>> {
  try {
    const raw = await Deno.readTextFile(LOCK_FILE);
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ── Main ───────────────────────────────────────────────────────────

export async function lint(): Promise<Violation[]> {
  const violations: Violation[] = [];
  let md: string;
  try {
    md = await Deno.readTextFile(THREAT_MODEL);
  } catch {
    violations.push({
      code: "I000",
      message: `Missing ${relative(ROOT, THREAT_MODEL)}. Create it before running this lint.`,
    });
    return violations;
  }

  const invariants = parseInvariants(md);
  const invariantIds = new Set(invariants.map((i) => i.id));
  const refs = await collectTestReferences();
  const lock = await loadLock();

  // I001: every declared invariant has ≥1 test (unless tests-pending).
  for (const inv of invariants) {
    if (inv.status === "tests-pending") continue;
    const tests = refs.get(inv.id) ?? [];
    if (tests.length === 0) {
      violations.push({
        code: "I001",
        file: relative(ROOT, THREAT_MODEL),
        line: inv.startLine,
        message: `${inv.id} declared with status=${inv.status} but has no matching test. Add test("${inv.id}: ...") in TS, fn inv_${inv.id.slice(4).toLowerCase()}_*() in Rust, or a // ${inv.id} metadata comment.`,
      });
    }
  }

  // I002: every test-referenced INV exists in threat-model.md.
  for (const [id, locs] of refs.entries()) {
    if (!invariantIds.has(id)) {
      for (const loc of locs) {
        violations.push({
          code: "I002",
          file: relative(ROOT, loc.file),
          line: loc.line,
          message: `Test references ${id} but it is not declared in docs/threat-model.md. Either declare it or remove the reference.`,
        });
      }
    }
  }

  // I003: lock-file hash matches current body.
  for (const inv of invariants) {
    const hash = await computeBodyHash(inv.body);
    const entry = lock[inv.id];
    if (!entry) {
      violations.push({
        code: "I003",
        file: "docs/threat-model.lock.json",
        message: `${inv.id} is declared in threat-model.md but missing from threat-model.lock.json. Add an entry with hash=${hash} and a justification.`,
      });
      continue;
    }
    if (entry.hash !== hash) {
      violations.push({
        code: "I003",
        file: "docs/threat-model.lock.json",
        message: `${inv.id} body hash drifted. Expected ${entry.hash}, got ${hash}. Update the lock entry with the new hash and a justification string explaining why the invariant changed.`,
      });
    }
    if (!entry.justification || entry.justification.trim() === "") {
      violations.push({
        code: "I003",
        file: "docs/threat-model.lock.json",
        message: `${inv.id} lock entry has empty justification. Describe why this invariant was added or changed.`,
      });
    }
  }

  // I004: every lock entry is declared in threat-model.md.
  for (const id of Object.keys(lock)) {
    if (!invariantIds.has(id)) {
      violations.push({
        code: "I004",
        file: "docs/threat-model.lock.json",
        message: `${id} is in lock.json but not declared in threat-model.md. Remove the orphan lock entry or re-add the invariant.`,
      });
    }
  }

  return violations;
}

function format(v: Violation): string {
  const loc = v.file ? `${v.file}${v.line ? `:${v.line}` : ""}` : "";
  return `[${v.code}] ${loc}${loc ? "  " : ""}${v.message}`;
}

if (import.meta.main) {
  const violations = await lint();
  if (violations.length === 0) {
    console.log("✓ invariant lint passed");
    Deno.exit(0);
  }
  console.error(`✗ invariant lint found ${violations.length} violation(s):\n`);
  for (const v of violations) console.error(format(v));
  Deno.exit(1);
}
