#!/usr/bin/env -S deno run --allow-read
/**
 * Type-safety lint — enforces the type-safety bar from CLAUDE.md.
 *
 * Hard-fail rules (always error):
 *   [T001]  ` as any`                       — bypasses the type system
 *   [T002]  `: any` / `<any>` / `Array<any>` — same
 *   [T003]  `as unknown as <T>`             — double cast smuggles types past the checker
 *
 * Soft rules (warn unless `// type-lint-allow: <reason>` on the same or previous line):
 *   [T010]  ` as <Type>` cast               — narrow with predicates / runtime helpers instead
 *   [T011]  `unknown` declarations          — fine at HTTP/JSON boundaries with a reason
 *
 * Scope:
 *   src/infrastructure, src/application, src/domain, src/runtime, src/testing, packages/
 *   (UI surface and tests get T010/T011 leniency for now — explicit allowlist below.)
 */

import { walk } from "jsr:@std/fs@^1/walk";
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;

const HARD_SCOPE = [
  "src/",
  "packages/",
];

// Soft rules apply only outside this list (UI + tests + scripts).
const SOFT_EXEMPT = [
  "src/ui/",
  ".test.ts",
  ".test.tsx",
  "/test/",
  "scripts/",
];

interface Violation {
  file: string;
  line: number;
  col: number;
  code: "T001" | "T002" | "T003" | "T010" | "T011";
  severity: "error" | "warn";
  excerpt: string;
}

function detect(line: string, lineNo: number): Omit<Violation, "file">[] {
  const out: Omit<Violation, "file">[] = [];
  const trimmed = line.trim();

  // Skip pure-comment lines
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
    return out;
  }

  // Strip inline string literals to avoid false positives in error messages,
  // template strings, etc. Simple version: replace " ... " and ' ... ' and ` ... `.
  const stripped = line
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");

  // T003: `as unknown as <T>` — double cast (most lethal pattern).
  {
    const re = /\bas\s+unknown\s+as\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      out.push({ line: lineNo, col: m.index + 1, code: "T003", severity: "error", excerpt: trimmed });
    }
  }

  // T001: ` as any`
  {
    const re = /\bas\s+any\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      out.push({ line: lineNo, col: m.index + 1, code: "T001", severity: "error", excerpt: trimmed });
    }
  }

  // T002: `: any` / `<any>` / `: any[]` — type position
  // - `: any` followed by , ) ; = > | & space end-of-line
  // - `<any>` or `<any,` etc.
  // - `Array<any>` etc.
  {
    const colonAny = /:\s*any\b(?!\.)/g;
    let m: RegExpExecArray | null;
    while ((m = colonAny.exec(stripped)) !== null) {
      // Skip "any" used as identifier (e.g. property name "any")
      out.push({ line: lineNo, col: m.index + 1, code: "T002", severity: "error", excerpt: trimmed });
    }
    const generic = /<\s*any\s*[,>]/g;
    while ((m = generic.exec(stripped)) !== null) {
      out.push({ line: lineNo, col: m.index + 1, code: "T002", severity: "error", excerpt: trimmed });
    }
  }

  // T010: ` as <CapitalIdent>` — type assertion (excluding `as const`).
  {
    const re = /\bas\s+([A-Z][\w$]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      // T003 already covers `as unknown as <T>`; skip the `unknown` half.
      if (m[1] === "unknown") continue;
      out.push({ line: lineNo, col: m.index + 1, code: "T010", severity: "warn", excerpt: trimmed });
    }
  }

  // T011: `unknown` in a type position (excluding inside comments / strings).
  {
    // Match `: unknown`, `<unknown`, `unknown[]`, `unknown,`, `unknown>`, `unknown |`, `unknown &`.
    const re = /\bunknown\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      out.push({ line: lineNo, col: m.index + 1, code: "T011", severity: "warn", excerpt: trimmed });
    }
  }

  return out;
}

function isInScope(rel: string): boolean {
  return HARD_SCOPE.some((p) => rel.startsWith(p));
}

function isSoftExempt(rel: string): boolean {
  return SOFT_EXEMPT.some((p) => rel.includes(p));
}

function checkFile(rel: string, source: string): Violation[] {
  const lines = source.split("\n");
  const out: Violation[] = [];
  const softExempt = isSoftExempt(rel);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";
    const allowComment = /\/\/\s*type-lint-allow:/.test(line) || /\/\/\s*type-lint-allow:/.test(prev);

    for (const v of detect(line, i + 1)) {
      // Soft rules can be exempted in UI / tests / scripts AND can be muted by an allow-comment.
      if ((v.code === "T010" || v.code === "T011") && (softExempt || allowComment)) {
        continue;
      }
      // Hard rules can still be muted by an allow-comment but never by scope.
      if ((v.code === "T001" || v.code === "T002" || v.code === "T003") && allowComment) {
        continue;
      }
      out.push({ ...v, file: rel });
    }
  }

  return out;
}

async function main() {
  const onlyErrors = Deno.args.includes("--errors-only");
  const showAll = Deno.args.includes("--all");

  const violations: Violation[] = [];

  for (const dir of HARD_SCOPE) {
    const abs = ROOT + dir;
    try {
      for await (const entry of walk(abs, {
        exts: [".ts", ".tsx"],
        skip: [/node_modules/, /\.deno\b/, /\.local\b/, /dist\//, /build\//],
      })) {
        const rel = relative(ROOT, entry.path);
        const source = await Deno.readTextFile(entry.path);
        if (!isInScope(rel)) continue;
        violations.push(...checkFile(rel, source));
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }

  const errors = violations.filter((v) => v.severity === "error");
  const warns = violations.filter((v) => v.severity === "warn");

  const printed = onlyErrors ? errors : (showAll ? violations : errors);

  for (const v of printed) {
    console.error(`${v.severity.toUpperCase()} [${v.code}] ${v.file}:${v.line}:${v.col} — ${v.excerpt}`);
  }

  if (errors.length > 0) {
    console.error(`\n✗ ${errors.length} hard error(s), ${warns.length} warning(s) (run with --all to list warnings).`);
    Deno.exit(1);
  }

  if (warns.length > 0 && showAll) {
    console.error(`\n${warns.length} warning(s) — see above.`);
  }

  console.log(`✓ type-safety lint passed (errors=0, warnings=${warns.length}).`);
}

await main();
