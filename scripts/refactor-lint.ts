#!/usr/bin/env -S deno run --allow-read
/**
 * Refactor Lint — detects code that likely needs refactoring.
 *
 * Rules:
 *   [R001] File exceeds 300 lines                        (error)
 *   [R002] Function/method exceeds 50 lines              (error)
 *   [R003] Function has more than 5 parameters            (warn)
 *   [R004] Nesting depth exceeds 4 levels                 (warn)
 *   [R005] File has more than 15 imports                  (warn)
 *   [R006] Cyclomatic complexity exceeds 10               (error)
 */

import { walk } from "jsr:@std/fs@^1/walk";
import { relative } from "jsr:@std/path@^1";

// ── Configuration ──────────────────────────────────────────────────

const SRC_DIR = new URL("../src/", import.meta.url).pathname;

const THRESHOLDS = {
  fileLines: 300,
  functionLines: 50,
  params: 5,
  nestingDepth: 4,
  imports: 15,
  cyclomaticComplexity: 10,
};

interface Violation {
  file: string;
  line: number;
  code: string;
  severity: "error" | "warn";
  message: string;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Match function/method declarations and arrow functions assigned to const/let. */
const FUNC_PATTERNS = [
  // function foo(...) { / async function foo(...) {
  /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
  // const foo = (...) => { / const foo = async (...) => {
  /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>/,
  // method(...) { / async method(...) { (class methods)
  /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{/,
];

interface FuncInfo {
  name: string;
  startLine: number;
  endLine: number;
  params: string[];
  body: string[];
}

/**
 * Extract function boundaries by tracking brace depth.
 * Returns a list of functions with their line ranges and bodies.
 */
function extractFunctions(lines: string[]): FuncInfo[] {
  const functions: FuncInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const trimmed = ln.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    for (const pattern of FUNC_PATTERNS) {
      const m = trimmed.match(pattern);
      if (!m) continue;

      const name = m[1];
      const paramsStr = m[2].trim();
      const params = paramsStr
        ? paramsStr.split(",").map((p) => p.trim()).filter(Boolean)
        : [];

      // Find the opening brace
      let braceStart = i;
      let found = false;
      for (let j = i; j < Math.min(i + 3, lines.length); j++) {
        if (lines[j].includes("{")) {
          braceStart = j;
          found = true;
          break;
        }
      }
      // Arrow functions without braces — single expression, skip
      if (!found) break;

      // Track braces to find end
      let depth = 0;
      let endLine = braceStart;
      for (let j = braceStart; j < lines.length; j++) {
        const line = lines[j];
        // Simple brace counting (ignores strings/comments for speed)
        for (const ch of line) {
          if (ch === "{") depth++;
          if (ch === "}") depth--;
        }
        if (depth === 0) {
          endLine = j;
          break;
        }
      }

      functions.push({
        name,
        startLine: i + 1,
        endLine: endLine + 1,
        params,
        body: lines.slice(braceStart, endLine + 1),
      });
      break;
    }
  }

  return functions;
}

/** Count branching keywords in a function body for cyclomatic complexity. */
function cyclomaticComplexity(body: string[]): number {
  let complexity = 1; // base path
  const branchPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bcase\s+/g,
    /\bwhile\s*\(/g,
    /\bfor\s*\(/g,
    /\bcatch\s*\(/g,
    /\?\?/g,
    /\?\s*[^:?]/g, // ternary (avoid matching ?. optional chaining)
    /&&/g,
    /\|\|/g,
  ];

  for (const line of body) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const pattern of branchPatterns) {
      pattern.lastIndex = 0;
      const matches = trimmed.match(pattern);
      if (matches) complexity += matches.length;
    }
  }
  return complexity;
}

/** Find maximum nesting depth within a function body. */
function maxNestingDepth(body: string[]): { depth: number; line: number } {
  let maxDepth = 0;
  let maxLine = 0;
  let currentDepth = 0;
  // Start at -1 to offset the function's own opening brace
  let offset = -1;

  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    for (const ch of line) {
      if (ch === "{") {
        currentDepth++;
        const logical = currentDepth + offset;
        if (logical > maxDepth) {
          maxDepth = logical;
          maxLine = i;
        }
      }
      if (ch === "}") currentDepth--;
    }
  }

  return { depth: maxDepth, line: maxLine };
}

/** Count import statements in a file. */
function countImports(lines: string[]): number {
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (/^(?:import|export\s.*from)\s/.test(trimmed)) count++;
  }
  return count;
}

// ── Checker ────────────────────────────────────────────────────────

function checkFile(relPath: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split("\n");

  // R001: File length
  if (lines.length > THRESHOLDS.fileLines) {
    violations.push({
      file: relPath,
      line: 1,
      code: "R001",
      severity: "error",
      message: `File has ${lines.length} lines (max ${THRESHOLDS.fileLines})`,
    });
  }

  // R005: Import count
  const importCount = countImports(lines);
  if (importCount > THRESHOLDS.imports) {
    violations.push({
      file: relPath,
      line: 1,
      code: "R005",
      severity: "warn",
      message: `File has ${importCount} imports (max ${THRESHOLDS.imports}) — consider splitting`,
    });
  }

  // Function-level checks
  const functions = extractFunctions(lines);
  for (const fn of functions) {
    const fnLines = fn.endLine - fn.startLine + 1;

    // R002: Function length
    if (fnLines > THRESHOLDS.functionLines) {
      violations.push({
        file: relPath,
        line: fn.startLine,
        code: "R002",
        severity: "error",
        message:
          `Function "${fn.name}" has ${fnLines} lines (max ${THRESHOLDS.functionLines})`,
      });
    }

    // R003: Parameter count
    if (fn.params.length > THRESHOLDS.params) {
      violations.push({
        file: relPath,
        line: fn.startLine,
        code: "R003",
        severity: "warn",
        message:
          `Function "${fn.name}" has ${fn.params.length} parameters (max ${THRESHOLDS.params})`,
      });
    }

    // R004: Nesting depth
    const nesting = maxNestingDepth(fn.body);
    if (nesting.depth > THRESHOLDS.nestingDepth) {
      violations.push({
        file: relPath,
        line: fn.startLine + nesting.line,
        code: "R004",
        severity: "warn",
        message:
          `Nesting depth ${nesting.depth} in "${fn.name}" (max ${THRESHOLDS.nestingDepth})`,
      });
    }

    // R006: Cyclomatic complexity
    const cc = cyclomaticComplexity(fn.body);
    if (cc > THRESHOLDS.cyclomaticComplexity) {
      violations.push({
        file: relPath,
        line: fn.startLine,
        code: "R006",
        severity: "error",
        message:
          `Cyclomatic complexity ${cc} in "${fn.name}" (max ${THRESHOLDS.cyclomaticComplexity})`,
      });
    }
  }

  return violations;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const onlyErrors = Deno.args.includes("--errors-only");
  const jsonOutput = Deno.args.includes("--json");
  const fileArgs = Deno.args.filter((a) => !a.startsWith("--"));

  const violations: Violation[] = [];

  if (fileArgs.length > 0) {
    for (const file of fileArgs) {
      const abs = file.startsWith("/") ? file : `${Deno.cwd()}/${file}`;
      if (!abs.startsWith(SRC_DIR)) continue;
      if (!abs.endsWith(".ts") && !abs.endsWith(".tsx")) continue;
      if (abs.endsWith(".test.ts") || abs.endsWith(".test.tsx")) continue;
      const rel = relative(SRC_DIR, abs);
      const source = await Deno.readTextFile(abs);
      violations.push(...checkFile(rel, source));
    }
  } else {
    for await (const entry of walk(SRC_DIR, {
      exts: [".ts", ".tsx"],
      skip: [/\.test\.tsx?$/, /node_modules/],
    })) {
      const rel = relative(SRC_DIR, entry.path);
      const source = await Deno.readTextFile(entry.path);
      violations.push(...checkFile(rel, source));
    }
  }

  const filtered = onlyErrors
    ? violations.filter((v) => v.severity === "error")
    : violations;

  if (jsonOutput) {
    console.log(JSON.stringify(filtered, null, 2));
    Deno.exit(filtered.some((v) => v.severity === "error") ? 1 : 0);
  }

  if (filtered.length === 0) {
    console.log("✓ No refactoring signals found.");
    Deno.exit(0);
  }

  const errors = filtered.filter((v) => v.severity === "error");
  const warns = filtered.filter((v) => v.severity === "warn");

  for (const v of errors) {
    console.error(`ERROR [${v.code}] src/${v.file}:${v.line} — ${v.message}`);
  }
  for (const v of warns) {
    console.warn(`WARN  [${v.code}] src/${v.file}:${v.line} — ${v.message}`);
  }

  console.log(
    `\n${errors.length} error(s), ${warns.length} warning(s)`,
  );
  Deno.exit(errors.length > 0 ? 1 : 0);
}

main();
