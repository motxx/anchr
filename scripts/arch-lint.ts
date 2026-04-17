#!/usr/bin/env -S deno run --allow-read
/**
 * Architecture Lint — enforces Clean Architecture layer dependency rules.
 *
 * Layers (inner → outer):
 *   domain  →  application  →  infrastructure
 *   runtime  (standalone)
 *   ui       (consumes domain types only)
 *
 * Rules:
 *   [E001] domain must not import from application, infrastructure, ui, or runtime
 *   [E002] runtime must not import from domain, application, infrastructure, or ui
 *   [E003] ui must not import from infrastructure or application
 *   [E004] Banned packages: express, dotenv, ws
 *   [E005] application must not import from infrastructure, ui, or runtime
 *   [W001] Prefer JSR over npm for packages that have JSR equivalents
 */

import { walk } from "jsr:@std/fs@^1/walk";
import { relative } from "jsr:@std/path@^1";

// ── Configuration ──────────────────────────────────────────────────

const SRC_DIR = new URL("../src/", import.meta.url).pathname;

/** Resolve a layer name from a file path relative to src/. */
function layerOf(rel: string): string | null {
  const first = rel.split("/")[0];
  if (["domain", "application", "infrastructure", "runtime", "ui"].includes(first)) {
    return first;
  }
  return null;
}

interface Violation {
  file: string;
  line: number;
  code: string;
  severity: "error" | "warn";
  message: string;
}

// Layer → set of layers it must NOT import from.
const FORBIDDEN_IMPORTS: Record<string, string[]> = {
  domain: ["application", "infrastructure", "ui", "runtime"],
  application: ["infrastructure", "ui", "runtime"],
  runtime: ["domain", "application", "infrastructure", "ui"],
  ui: ["infrastructure", "application"],
};

const BANNED_PACKAGES = new Set(["express", "dotenv", "ws"]);

// npm specifier → JSR alternative hint
const JSR_PREFERRED: Record<string, string> = {
  "npm:hono": "jsr:@hono/hono",
  "npm:zod": "jsr:@zod/zod",
  "npm:@noble/hashes": "jsr:@noble/hashes",
};

// ── Parsing ────────────────────────────────────────────────────────

const IMPORT_RE = /(?:^|\s)(?:import|export)\s.*?from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

function extractImports(source: string): { specifier: string; line: number }[] {
  const results: { specifier: string; line: number }[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // Skip comments
    const trimmed = ln.trimStart();
    if (trimmed.startsWith("//")) continue;

    for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ln)) !== null) {
        results.push({ specifier: m[1], line: i + 1 });
      }
    }
  }
  return results;
}

/**
 * Resolve a relative import specifier to a layer name.
 * E.g. "../infrastructure/cashu/wallet" → "infrastructure"
 */
function resolveRelativeLayer(specifier: string, fileRelDir: string): string | null {
  if (!specifier.startsWith(".")) return null;
  // Normalize: join the file's directory with the specifier
  const parts = fileRelDir.split("/").concat(specifier.split("/"));
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") {
      resolved.pop();
    } else {
      resolved.push(p);
    }
  }
  return layerOf(resolved.join("/"));
}

// ── Checker ────────────────────────────────────────────────────────

function checkFile(
  relPath: string,
  source: string,
): Violation[] {
  const violations: Violation[] = [];
  const layer = layerOf(relPath);
  if (!layer) return violations; // file not in a known layer

  const forbidden = FORBIDDEN_IMPORTS[layer] ?? [];
  const imports = extractImports(source);
  const relDir = relPath.split("/").slice(0, -1).join("/");

  for (const { specifier, line } of imports) {
    // ── E001/E002/E003: Layer dependency ──
    const targetLayer = resolveRelativeLayer(specifier, relDir);
    if (targetLayer && forbidden.includes(targetLayer)) {
      const code = layer === "domain" ? "E001"
        : layer === "runtime" ? "E002"
        : layer === "ui" ? "E003"
        : layer === "application" ? "E005"
        : "E001";
      violations.push({
        file: relPath,
        line,
        code,
        severity: "error",
        message: `${layer}/ must not import from ${targetLayer}/ (found "${specifier}")`,
      });
    }

    // ── E004: Banned packages ──
    const bare = specifier.replace(/^npm:/, "");
    const pkgName = bare.startsWith("@")
      ? bare.split("/").slice(0, 2).join("/")
      : bare.split("/")[0];
    if (BANNED_PACKAGES.has(pkgName)) {
      violations.push({
        file: relPath,
        line,
        code: "E004",
        severity: "error",
        message: `Banned package "${pkgName}" — use the Deno/Hono equivalent`,
      });
    }

    // ── W001: JSR preferred ──
    for (const [npmPrefix, jsrAlt] of Object.entries(JSR_PREFERRED)) {
      if (specifier.startsWith(npmPrefix)) {
        violations.push({
          file: relPath,
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

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const onlyErrors = Deno.args.includes("--errors-only");
  const jsonOutput = Deno.args.includes("--json");
  // Allow checking specific files (for hook mode)
  const fileArgs = Deno.args.filter((a) => !a.startsWith("--"));

  const violations: Violation[] = [];

  if (fileArgs.length > 0) {
    // Check only specified files
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
    // Walk the full src/ directory
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
    console.log("✓ No architecture violations found.");
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
