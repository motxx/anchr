#!/usr/bin/env -S deno run --allow-read
/**
 * Architecture Lint — enforces Clean Architecture layer dependency rules
 * inside `src/` AND inter-package dependency rules across `packages/`.
 *
 * src/ layers (inner → outer):
 *   domain  →  application  →  infrastructure
 *   ui     (consumes domain types only)
 *
 * Rules (src/):
 *   [E001] domain must not import from application, infrastructure, or ui
 *   [E003] ui must not import from infrastructure or application
 *   [E004] Banned packages: express, dotenv, ws
 *   [E005] application must not import from infrastructure or ui
 *   [W001] Prefer JSR over npm for packages that have JSR equivalents
 *
 * Rules (packages/):
 *   [E010] core-runtime must not depend on any other @anchr/* package
 *   [E012] core-cashu may only depend on core-runtime
 *   [E013] tlsn-toolkit may only depend on core-runtime
 *   [E014] photo-bounty may only depend on core-runtime
 *   [E015] cashu-frost-oracle may only depend on core-runtime
 *   [E016] cashu-conditional-swap may only depend on core-cashu, cashu-frost-oracle, core-runtime
 *   [E017] sdk must not depend on any host-side @anchr/* package (other than core-runtime if needed)
 */

import { walk } from "jsr:@std/fs@^1/walk";
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;
const SRC_DIR = `${ROOT}src/`;
const PKG_DIR = `${ROOT}packages/`;

interface Violation {
  file: string;
  line: number;
  code: string;
  severity: "error" | "warn";
  message: string;
}

// ── src/ layer rules ───────────────────────────────────────────────

const SRC_LAYERS = ["domain", "application", "infrastructure", "ui"] as const;
type SrcLayer = (typeof SRC_LAYERS)[number];

const SRC_FORBIDDEN: Record<SrcLayer, SrcLayer[]> = {
  domain: ["application", "infrastructure", "ui"],
  application: ["infrastructure", "ui"],
  infrastructure: [],
  ui: ["infrastructure", "application"],
};

function srcLayerOf(rel: string): SrcLayer | null {
  const first = rel.split("/")[0];
  return SRC_LAYERS.includes(first as SrcLayer) ? (first as SrcLayer) : null;
}

// ── packages/ rules ────────────────────────────────────────────────

const ALLOWED_PACKAGE_DEPS: Record<string, ReadonlySet<string>> = {
  "core-runtime": new Set<string>(),
  "core-cashu": new Set<string>(["core-runtime"]),
  "tlsn-toolkit": new Set<string>(["core-runtime"]),
  "photo-bounty": new Set<string>(["core-runtime"]),
  "cashu-frost-oracle": new Set<string>(["core-runtime"]),
  "cashu-conditional-swap": new Set<string>(["core-runtime", "core-cashu", "cashu-frost-oracle"]),
  "sdk": new Set<string>(["core-runtime"]),
};

const BANNED_PACKAGES = new Set(["express", "dotenv", "ws"]);

const JSR_PREFERRED: Record<string, string> = {
  "npm:hono": "jsr:@hono/hono",
  "npm:zod": "jsr:@zod/zod",
  "npm:@noble/hashes": "jsr:@noble/hashes",
};

// ── Parsing ────────────────────────────────────────────────────────

// Multi-line import / export-from / dynamic-import. The `[\s\S]` pattern
// crosses newlines so we catch:
//   import {\n  A,\n  B\n} from "x";
//   export type {\n  T\n} from "x";
//   await import("x");
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function extractImports(source: string): { specifier: string; line: number }[] {
  const results: { specifier: string; line: number }[] = [];

  // Strip line and block comments so we don't match strings inside them.
  // Conservative: keep length stable by replacing comment chars with spaces.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|\n)([^\n]*?)\/\/[^\n]*/g, (_m, p1, p2) => `${p1}${p2}${" ".repeat(0)}`);

  function lineOf(offset: number): number {
    let line = 1;
    for (let i = 0; i < offset; i++) {
      if (stripped[i] === "\n") line++;
    }
    return line;
  }

  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      results.push({ specifier: m[1], line: lineOf(m.index) });
    }
  }
  return results;
}

function resolveRelativeSrcLayer(specifier: string, fileRelDir: string): SrcLayer | null {
  if (!specifier.startsWith(".")) return null;
  const parts = fileRelDir.split("/").concat(specifier.split("/"));
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") resolved.pop();
    else resolved.push(p);
  }
  return srcLayerOf(resolved.join("/"));
}

/**
 * Resolve which @anchr package a specifier points at.
 *
 * Workspace specifier: `@anchr/<pkg>` or `@anchr/<pkg>/<subpath>`
 * Relative path:       `../<pkg>/...` from inside packages/<other>/src/
 * Host path:           `../../packages/<pkg>/...` from src/
 */
function resolvePackageDep(specifier: string, fileRel: string): string | null {
  if (specifier.startsWith("@anchr/")) {
    return specifier.split("/")[1] ?? null;
  }
  if (specifier.includes("packages/")) {
    const m = specifier.match(/packages\/([^/]+)/);
    if (m) return m[1];
  }
  // Cross-package via relative `../<pkg>/...` from packages/<x>/src/...
  if (fileRel.startsWith("packages/") && specifier.startsWith("../")) {
    const fileParts = fileRel.split("/").slice(0, -1);
    const specParts = specifier.split("/");
    const merged: string[] = [...fileParts];
    for (const p of specParts) {
      if (p === "." || p === "") continue;
      if (p === "..") merged.pop();
      else merged.push(p);
    }
    if (merged[0] === "packages" && merged[1]) return merged[1];
  }
  return null;
}

// ── Checker ────────────────────────────────────────────────────────

function checkSrcFile(rel: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const layer = srcLayerOf(rel);
  if (!layer) return violations;

  const forbidden: SrcLayer[] = SRC_FORBIDDEN[layer];
  const imports = extractImports(source);
  const relDir = rel.split("/").slice(0, -1).join("/");

  for (const { specifier, line } of imports) {
    const targetLayer = resolveRelativeSrcLayer(specifier, relDir);
    if (targetLayer && forbidden.includes(targetLayer)) {
      const code = layer === "domain" ? "E001"
        : layer === "ui" ? "E003"
        : layer === "application" ? "E005"
        : "E001";
      violations.push({
        file: `src/${rel}`,
        line,
        code,
        severity: "error",
        message: `${layer}/ must not import from ${targetLayer}/ (found "${specifier}")`,
      });
    }

    const bare = specifier.replace(/^npm:/, "");
    const pkgName = bare.startsWith("@") ? bare.split("/").slice(0, 2).join("/") : bare.split("/")[0];
    if (BANNED_PACKAGES.has(pkgName)) {
      violations.push({
        file: `src/${rel}`,
        line,
        code: "E004",
        severity: "error",
        message: `Banned package "${pkgName}" — use the Deno/Hono equivalent`,
      });
    }

    for (const [npmPrefix, jsrAlt] of Object.entries(JSR_PREFERRED)) {
      if (specifier.startsWith(npmPrefix)) {
        violations.push({
          file: `src/${rel}`,
          line,
          code: "W001",
          severity: "warn",
          message: `Prefer "${jsrAlt}" over "${specifier}" (supply-chain safety)`,
        });
      }
    }
  }

  return violations;
}

function checkPackageFile(pkg: string, fileRel: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const allowed = ALLOWED_PACKAGE_DEPS[pkg];
  if (!allowed) return violations;

  const imports = extractImports(source);
  for (const { specifier, line } of imports) {
    const dep = resolvePackageDep(specifier, fileRel);
    if (!dep || dep === pkg) continue;

    if (!allowed.has(dep)) {
      const code = pkg === "core-runtime" ? "E010"
        : pkg === "core-cashu" ? "E012"
        : pkg === "tlsn-toolkit" ? "E013"
        : pkg === "photo-bounty" ? "E014"
        : pkg === "cashu-frost-oracle" ? "E015"
        : pkg === "cashu-conditional-swap" ? "E016"
        : pkg === "sdk" ? "E017"
        : "E010";
      violations.push({
        file: fileRel,
        line,
        code,
        severity: "error",
        message: `Package "${pkg}" must not depend on "${dep}" (allowed: ${[...allowed].join(", ") || "none"})`,
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

  async function checkPath(abs: string) {
    if (!abs.endsWith(".ts") && !abs.endsWith(".tsx")) return;
    if (abs.endsWith(".test.ts") || abs.endsWith(".test.tsx")) return;
    const source = await Deno.readTextFile(abs);
    if (abs.startsWith(SRC_DIR)) {
      const rel = relative(SRC_DIR, abs);
      violations.push(...checkSrcFile(rel, source));
    } else if (abs.startsWith(PKG_DIR)) {
      const rel = relative(ROOT, abs);
      const pkgPath = relative(PKG_DIR, abs);
      const pkg = pkgPath.split("/")[0];
      violations.push(...checkPackageFile(pkg, rel, source));
    }
  }

  if (fileArgs.length > 0) {
    for (const file of fileArgs) {
      const abs = file.startsWith("/") ? file : `${Deno.cwd()}/${file}`;
      await checkPath(abs);
    }
  } else {
    for await (const entry of walk(SRC_DIR, { exts: [".ts", ".tsx"], skip: [/\.test\.tsx?$/, /node_modules/] })) {
      await checkPath(entry.path);
    }
    for await (const entry of walk(PKG_DIR, { exts: [".ts", ".tsx"], skip: [/\.test\.tsx?$/, /node_modules/] })) {
      await checkPath(entry.path);
    }
  }

  const filtered = onlyErrors ? violations.filter((v) => v.severity === "error") : violations;

  if (jsonOutput) {
    console.log(JSON.stringify(filtered, null, 2));
    Deno.exit(filtered.some((v) => v.severity === "error") ? 1 : 0);
  }

  if (filtered.length === 0) {
    console.log("✓ No architecture violations found.");
    Deno.exit(0);
  }

  const errors = filtered.filter((v) => v.severity === "error");
  const warns = filtered.filter((v) => v.severity === "warn");

  for (const v of errors) console.error(`ERROR [${v.code}] ${v.file}:${v.line} — ${v.message}`);
  for (const v of warns) console.warn(`WARN  [${v.code}] ${v.file}:${v.line} — ${v.message}`);

  console.log(`\n${errors.length} error(s), ${warns.length} warning(s)`);
  Deno.exit(errors.length > 0 ? 1 : 0);
}

main();
