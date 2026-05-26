#!/usr/bin/env -S deno run --allow-read
/**
 * Architecture lint for the final Anchr public surface.
 *
 * The public package graph is intentionally small:
 *   [E025] protocol must not depend on another @anchr/* package.
 *   [E017] sdk may depend on protocol and no other @anchr/* package.
 *   [E023] examples, e2e tests, and top-level scripts must reach Anchr
 *          through @anchr/sdk or @anchr/protocol public subpaths only.
 *   [E022] application vocabulary must not leak into package code.
 *
 * Per-line opt-out:
 *   // allow-arch: <reason>
 */

import { walk } from "jsr:@std/fs@^1/walk";
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;
const PKG_DIR = `${ROOT}packages/`;
const PUBLIC_SURFACE_DIRS = ["examples", "e2e", "scripts"] as const;

interface Violation {
  file: string;
  line: number;
  code: string;
  severity: "error" | "warn";
  message: string;
}

const ALLOWED_PACKAGE_DEPS: Record<string, ReadonlySet<string>> = {
  "protocol": new Set<string>(),
  "sdk": new Set<string>(["protocol"]),
};

const OPT_OUT = /\/\/\s*allow-arch:/;
const APP_VOCAB =
  /\b(market|marketplace|markets|marketplaces|Market|Marketplace|Markets|Marketplaces)\b/;

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function extractImports(source: string): { specifier: string; line: number }[] {
  const results: { specifier: string; line: number }[] = [];
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(
      /(^|\n)([^\n]*?)\/\/[^\n]*/g,
      (_m, p1, p2) => `${p1}${p2}`,
    );

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

function resolvePackageDep(specifier: string, fileRel: string): string | null {
  if (specifier.startsWith("@anchr/")) {
    return specifier.split("/")[1] ?? null;
  }
  if (specifier.includes("packages/")) {
    const m = specifier.match(/packages\/([^/]+)/);
    if (m) return m[1];
  }
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

function relativeTargetsPackageSrc(
  specifier: string,
  fileRel: string,
): boolean {
  if (!specifier.startsWith(".")) return false;
  const fileParts = fileRel.split("/").slice(0, -1);
  const specParts = specifier.split("/");
  const merged: string[] = [...fileParts];
  for (const p of specParts) {
    if (p === "." || p === "") continue;
    if (p === "..") merged.pop();
    else merged.push(p);
  }
  return merged[0] === "packages" && merged.includes("src");
}

interface ContentHit {
  line: number;
  match: string;
}

function scanContentLines(source: string, pattern: RegExp): ContentHit[] {
  const hits: ContentHit[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (OPT_OUT.test(line)) continue;
    const m = line.match(pattern);
    if (m) hits.push({ line: i + 1, match: m[0] });
  }
  return hits;
}

function isPublicAnchrSpecifier(specifier: string): boolean {
  return specifier === "@anchr/sdk" ||
    specifier.startsWith("@anchr/sdk/") ||
    specifier === "@anchr/protocol" ||
    specifier.startsWith("@anchr/protocol/");
}

function checkPackageFile(
  pkg: string,
  fileRel: string,
  source: string,
): Violation[] {
  const violations: Violation[] = [];

  for (const hit of scanContentLines(source, APP_VOCAB)) {
    violations.push({
      file: fileRel,
      line: hit.line,
      code: "E022",
      severity: "error",
      message: `application vocabulary "${hit.match}" not allowed in packages/`,
    });
  }

  const allowed = ALLOWED_PACKAGE_DEPS[pkg];
  if (!allowed) return violations;

  for (const { specifier, line } of extractImports(source)) {
    const dep = resolvePackageDep(specifier, fileRel);
    if (!dep || dep === pkg) continue;
    if (!allowed.has(dep)) {
      violations.push({
        file: fileRel,
        line,
        code: pkg === "protocol" ? "E025" : "E017",
        severity: "error",
        message: `Package "${pkg}" must not depend on "${dep}" (allowed: ${
          [...allowed].join(", ") || "none"
        })`,
      });
    }
  }

  return violations;
}

function checkPublicSurfaceFile(fileRel: string, source: string): Violation[] {
  const violations: Violation[] = [];

  for (const { specifier, line } of extractImports(source)) {
    if (specifier.startsWith("@anchr/") && !isPublicAnchrSpecifier(specifier)) {
      violations.push({
        file: fileRel,
        line,
        code: "E023",
        severity: "error",
        message:
          `public repository surfaces may import only @anchr/sdk or @anchr/protocol (found "${specifier}")`,
      });
    }
    if (relativeTargetsPackageSrc(specifier, fileRel)) {
      violations.push({
        file: fileRel,
        line,
        code: "E023",
        severity: "error",
        message:
          `public repository surfaces must use @anchr/* public subpaths, not "${specifier}"`,
      });
    }
  }

  return violations;
}

async function main() {
  const onlyErrors = Deno.args.includes("--errors-only");
  const jsonOutput = Deno.args.includes("--json");
  const fileArgs = Deno.args.filter((arg) => !arg.startsWith("--"));
  const violations: Violation[] = [];

  async function checkPath(abs: string) {
    if (!abs.endsWith(".ts") && !abs.endsWith(".tsx")) return;
    const source = await Deno.readTextFile(abs);
    const rel = relative(ROOT, abs);

    if (abs.startsWith(PKG_DIR)) {
      if (abs.endsWith(".test.ts") || abs.endsWith(".test.tsx")) return;
      const pkg = relative(PKG_DIR, abs).split("/")[0];
      violations.push(...checkPackageFile(pkg, rel, source));
      return;
    }

    if (PUBLIC_SURFACE_DIRS.some((dir) => rel.startsWith(`${dir}/`))) {
      violations.push(...checkPublicSurfaceFile(rel, source));
    }
  }

  if (fileArgs.length > 0) {
    for (const file of fileArgs) {
      const abs = file.startsWith("/") ? file : `${Deno.cwd()}/${file}`;
      await checkPath(abs);
    }
  } else {
    for await (
      const entry of walk(PKG_DIR, {
        exts: [".ts", ".tsx"],
        skip: [/\.test\.tsx?$/, /node_modules/, /dist\//],
      })
    ) {
      await checkPath(entry.path);
    }
    for (const dir of PUBLIC_SURFACE_DIRS) {
      try {
        for await (
          const entry of walk(`${ROOT}${dir}`, {
            exts: [".ts", ".tsx"],
            skip: [/node_modules/, /dist\//],
          })
        ) {
          await checkPath(entry.path);
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }

  const printable = onlyErrors
    ? violations.filter((v) => v.severity === "error")
    : violations;

  if (jsonOutput) {
    console.log(JSON.stringify(printable, null, 2));
  } else {
    for (const v of printable) {
      console.error(
        `${v.severity.toUpperCase()} [${v.code}] ${v.file}:${v.line} — ${v.message}`,
      );
    }
  }

  const errors = violations.filter((v) => v.severity === "error");
  const warns = violations.filter((v) => v.severity === "warn");

  if (errors.length > 0) {
    console.error(
      `\n✗ ${errors.length} architecture error(s), ${warns.length} warning(s)`,
    );
    Deno.exit(1);
  }

  if (!jsonOutput) {
    console.log("✓ No architecture violations found.");
  }
}

if (import.meta.main) {
  await main();
}
