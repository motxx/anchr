#!/usr/bin/env -S deno run --allow-read
/**
 * Architecture Lint — enforces Clean Architecture layer dependency rules
 * inside `packages/runtime/` AND inter-package dependency rules across
 * `packages/`.
 *
 * Layer rules apply inside `packages/runtime/src/` (the host's
 * domain/application/infrastructure tree). Other packages are checked
 * by the package-dep allow-list below.
 *
 * Layers (inner → outer):
 *   domain  →  application  →  infrastructure
 *
 * Rules (runtime layers — import / dependency):
 *   [E001] domain must not import from application or infrastructure
 *   [E004] Banned packages: express, dotenv, ws
 *   [E005] application must not import from infrastructure
 *   [E009] only test files may import from packages/runtime/src/testing/
 *   [E018] runtime must not depend on @anchr/sdk (downstream-consumer SDK)
 *   [W001] Prefer JSR over npm for packages that have JSR equivalents
 *
 * Rules (runtime layers — content):
 *   [E007] Deno.* not allowed in domain/ (must be wrapped behind a port)
 *   [E008] Deno.* not allowed in application/ (use injected ports)
 *   [E021] console.* not allowed in application/ or infrastructure/
 *          (use @anchr/core-runtime/logger; log-stream.ts is exempt as
 *          the sanctioned tee target)
 *
 * Rules (packages/):
 *   [E010] core-runtime must not depend on any other @anchr/* package
 *   [E012] core-cashu may only depend on core-runtime
 *   [E013] tlsn-toolkit may only depend on core-runtime
 *   [E014] photo-verification may only depend on core-runtime
 *   [E015] frost-oracle may only depend on core-runtime
 *   [E016] cashu-conditional-swap may only depend on
 *          core-runtime, core-cashu, frost-oracle
 *   [E019] blossom may only depend on core-runtime
 *   [E024] runtime may depend on every primitive package except sdk
 *   [E017] sdk must not depend on any host-side @anchr/* package (other
 *          than core-runtime)
 *
 * Rules (example/):
 *   [E023] example/<app>/ must reach Anchr only through `@anchr/*`
 *          (or external npm/jsr). Reaching into `packages/<pkg>/src/...`
 *          via relative path is a violation — that bypasses the
 *          package's public surface.
 *
 * Per-line opt-out (same line):
 *   // allow-arch: <reason>
 */

import { walk } from "jsr:@std/fs@^1/walk";
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;
const RUNTIME_SRC = `${ROOT}packages/runtime/src/`;
const PKG_DIR = `${ROOT}packages/`;
const EXAMPLE_DIR = `${ROOT}example/`;

interface Violation {
  file: string;
  line: number;
  code: string;
  severity: "error" | "warn";
  message: string;
}

// ── src/ layer rules ───────────────────────────────────────────────

const SRC_LAYERS = ["domain", "application", "infrastructure"] as const;
type SrcLayer = (typeof SRC_LAYERS)[number];

const SRC_FORBIDDEN: Record<SrcLayer, SrcLayer[]> = {
  domain: ["application", "infrastructure"],
  application: ["infrastructure"],
  infrastructure: [],
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
  "photo-verification": new Set<string>(["core-runtime"]),
  "frost-oracle": new Set<string>(["core-runtime"]),
  "cashu-conditional-swap": new Set<string>(["core-runtime", "core-cashu", "frost-oracle"]),
  "blossom": new Set<string>(["core-runtime"]),
  "runtime": new Set<string>([
    "core-runtime",
    "core-cashu",
    "tlsn-toolkit",
    "photo-verification",
    "frost-oracle",
    "cashu-conditional-swap",
    "blossom",
  ]),
  "sdk": new Set<string>(["core-runtime"]),
};

const BANNED_PACKAGES = new Set(["express", "dotenv", "ws"]);

const JSR_PREFERRED: Record<string, string> = {
  "npm:hono": "jsr:@hono/hono",
  "npm:zod": "jsr:@zod/zod",
  "npm:@noble/hashes": "jsr:@noble/hashes",
};

// Files that are sanctioned exceptions to a content rule. Keep this set
// small and named — every entry is a load-bearing exception, not a TODO.
const E021_CONSOLE_EXEMPT = new Set<string>([
  // The sanctioned console tee. Intercepts and re-emits — the only spot
  // where `console.*` is the API, not an accidental logger.
  "packages/runtime/src/infrastructure/log-stream.ts",
]);

// Test fixture files that legitimately contain references to
// otherwise-banned content (used by other tests).
function isTestSupport(rel: string): boolean {
  return rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.startsWith("testing/");
}

const OPT_OUT = /\/\/\s*allow-arch:/;

// ── Parsing ────────────────────────────────────────────────────────

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function extractImports(source: string): { specifier: string; line: number }[] {
  const results: { specifier: string; line: number }[] = [];

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

/**
 * Detect when a packages/ file imports from src/ via a relative path.
 * Workspace JSR specs and `@anchr/*` are package-to-package; only the
 * relative `../../src/...` form is the violation we're after.
 */
function relativeTargetsHostSrc(specifier: string, fileRel: string): boolean {
  if (!specifier.startsWith(".")) return false;
  if (!fileRel.startsWith("packages/")) return false;
  const fileParts = fileRel.split("/").slice(0, -1);
  const specParts = specifier.split("/");
  const merged: string[] = [...fileParts];
  for (const p of specParts) {
    if (p === "." || p === "") continue;
    if (p === "..") merged.pop();
    else merged.push(p);
  }
  return merged[0] === "src";
}

// ── Content scanners ────────────────────────────────────────────────

const DENO_CALL = /\bDeno\.[a-zA-Z]/;
const CONSOLE_CALL = /\bconsole\.(log|error|warn|info|debug|trace)\b/;
/**
 * Application-layer vocabulary that must not leak into core primitives.
 * The lint catches naming drift before it spreads — e.g. a fresh contributor
 * adding a `marketX` field to a `domain/` type would be reminded that the
 * SDK is application-agnostic. Concrete usage of these terms lives in
 * `example/<app>/` and is fine there.
 */
const APP_VOCAB = /\b(market|marketplace|markets|marketplaces|Market|Marketplace|Markets|Marketplaces)\b/;

interface ContentHit {
  line: number;
  match: string;
}

function scanContentLines(source: string, pattern: RegExp): ContentHit[] {
  const hits: ContentHit[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const trimmed = ln.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (OPT_OUT.test(ln)) continue;
    const m = ln.match(pattern);
    if (m) hits.push({ line: i + 1, match: m[0] });
  }
  return hits;
}

// ── Checker ────────────────────────────────────────────────────────

function checkSrcFile(rel: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const layer = srcLayerOf(rel);
  const isTest = isTestSupport(rel);
  if (!layer) return violations;

  const forbidden: SrcLayer[] = SRC_FORBIDDEN[layer];
  const imports = extractImports(source);
  const relDir = rel.split("/").slice(0, -1).join("/");

  for (const { specifier, line } of imports) {
    const targetLayer = resolveRelativeSrcLayer(specifier, relDir);
    if (targetLayer && forbidden.includes(targetLayer)) {
      const code = layer === "domain" ? "E001"
        : layer === "application" ? "E005"
        : "E001";
      violations.push({
        file: `packages/runtime/src/${rel}`,
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
        file: `packages/runtime/src/${rel}`,
        line,
        code: "E004",
        severity: "error",
        message: `Banned package "${pkgName}" — use the Deno/Hono equivalent`,
      });
    }

    // E018 — src/ must not depend on @anchr/sdk
    if (specifier === "@anchr/sdk" || specifier.startsWith("@anchr/sdk/")) {
      violations.push({
        file: `packages/runtime/src/${rel}`,
        line,
        code: "E018",
        severity: "error",
        message: `src/ must not import from "@anchr/sdk" (the SDK is downstream of the host)`,
      });
    }

    // E009 — only test files may import from packages/runtime/src/testing/
    if (!isTest) {
      const targetIsTesting =
        (specifier.startsWith(".") &&
          (() => {
            const parts = relDir.split("/").concat(specifier.split("/"));
            const resolved: string[] = [];
            for (const p of parts) {
              if (p === "." || p === "") continue;
              if (p === "..") resolved.pop();
              else resolved.push(p);
            }
            return resolved[0] === "testing";
          })()) ||
        specifier.includes("/packages/runtime/src/testing/");
      if (targetIsTesting) {
        violations.push({
          file: `packages/runtime/src/${rel}`,
          line,
          code: "E009",
          severity: "error",
          message: `non-test code must not import from packages/runtime/src/testing/ (found "${specifier}")`,
        });
      }
    }

    for (const [npmPrefix, jsrAlt] of Object.entries(JSR_PREFERRED)) {
      if (specifier.startsWith(npmPrefix)) {
        violations.push({
          file: `packages/runtime/src/${rel}`,
          line,
          code: "W001",
          severity: "warn",
          message: `Prefer "${jsrAlt}" over "${specifier}" (supply-chain safety)`,
        });
      }
    }
  }

  // Content rules — skip test-support files, they're allowed to mock anything.
  if (!isTest) {
    if (layer === "domain") {
      for (const h of scanContentLines(source, DENO_CALL)) {
        violations.push({
          file: `packages/runtime/src/${rel}`,
          line: h.line,
          code: "E007",
          severity: "error",
          message: `Deno.* not allowed in domain/ (found "${h.match}") — wrap behind a port`,
        });
      }
    }
    if (layer === "application") {
      for (const h of scanContentLines(source, DENO_CALL)) {
        violations.push({
          file: `packages/runtime/src/${rel}`,
          line: h.line,
          code: "E008",
          severity: "error",
          message: `Deno.* not allowed in application/ (found "${h.match}") — inject a port`,
        });
      }
    }
    if ((layer === "application" || layer === "infrastructure") && !E021_CONSOLE_EXEMPT.has(`packages/runtime/src/${rel}`)) {
      for (const h of scanContentLines(source, CONSOLE_CALL)) {
        violations.push({
          file: `packages/runtime/src/${rel}`,
          line: h.line,
          code: "E021",
          severity: "error",
          message: `console.${h.match} not allowed in ${layer}/ — use @anchr/core-runtime/logger`,
        });
      }
    }
    for (const h of scanContentLines(source, APP_VOCAB)) {
      violations.push({
        file: `packages/runtime/src/${rel}`,
        line: h.line,
        code: "E022",
        severity: "error",
        message: `application vocabulary "${h.match}" not allowed in packages/runtime — concrete apps belong in example/`,
      });
    }
  }

  return violations;
}

// ── example/ rule ──────────────────────────────────────────────────

/**
 * Returns the example app name (`example/<app>/...`) if the file lives
 * inside one, else null. Used to scope per-example checks.
 */
function exampleNameOf(fileRel: string): string | null {
  if (!fileRel.startsWith("example/")) return null;
  return fileRel.split("/")[1] ?? null;
}

/**
 * Detect when an example file imports from `packages/<pkg>/src/...` via
 * a relative path. Examples must reach Anchr only through `@anchr/*`.
 */
function exampleReachesIntoPackageSrc(specifier: string, fileRel: string): boolean {
  if (!specifier.startsWith(".")) return false;
  if (!fileRel.startsWith("example/")) return false;
  const fileParts = fileRel.split("/").slice(0, -1);
  const specParts = specifier.split("/");
  const merged: string[] = [...fileParts];
  for (const p of specParts) {
    if (p === "." || p === "") continue;
    if (p === "..") merged.pop();
    else merged.push(p);
  }
  return merged[0] === "packages";
}

function checkExampleFile(fileRel: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const example = exampleNameOf(fileRel);
  if (!example) return violations;

  const imports = extractImports(source);
  for (const { specifier, line } of imports) {
    if (exampleReachesIntoPackageSrc(specifier, fileRel)) {
      violations.push({
        file: fileRel,
        line,
        code: "E023",
        severity: "error",
        message:
          `example/${example}/ must reach Anchr through "@anchr/*" only ` +
          `(found relative path "${specifier}" pointing into packages/)`,
      });
    }
  }
  return violations;
}

function checkPackageFile(pkg: string, fileRel: string, source: string): Violation[] {
  const violations: Violation[] = [];

  for (const h of scanContentLines(source, APP_VOCAB)) {
    violations.push({
      file: fileRel,
      line: h.line,
      code: "E022",
      severity: "error",
      message: `application vocabulary "${h.match}" not allowed in packages/ — concrete apps belong in example/`,
    });
  }

  const allowed = ALLOWED_PACKAGE_DEPS[pkg];
  if (!allowed) return violations;

  const imports = extractImports(source);
  for (const { specifier, line } of imports) {
    if (relativeTargetsHostSrc(specifier, fileRel)) {
      violations.push({
        file: fileRel,
        line,
        code: "E020",
        severity: "error",
        message: `package "${pkg}" must not import from src/ (one-way: src → packages, never the reverse)`,
      });
      continue;
    }

    const dep = resolvePackageDep(specifier, fileRel);
    if (!dep || dep === pkg) continue;

    if (!allowed.has(dep)) {
      const code = pkg === "core-runtime" ? "E010"
        : pkg === "core-cashu" ? "E012"
        : pkg === "tlsn-toolkit" ? "E013"
        : pkg === "photo-verification" ? "E014"
        : pkg === "frost-oracle" ? "E015"
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
    if (abs.startsWith(RUNTIME_SRC)) {
      const rel = relative(RUNTIME_SRC, abs);
      violations.push(...checkSrcFile(rel, source));
    }
    if (abs.startsWith(PKG_DIR)) {
      const rel = relative(ROOT, abs);
      const pkgPath = relative(PKG_DIR, abs);
      const pkg = pkgPath.split("/")[0];
      violations.push(...checkPackageFile(pkg, rel, source));
    } else if (abs.startsWith(EXAMPLE_DIR)) {
      const rel = relative(ROOT, abs);
      violations.push(...checkExampleFile(rel, source));
    }
  }

  if (fileArgs.length > 0) {
    for (const file of fileArgs) {
      const abs = file.startsWith("/") ? file : `${Deno.cwd()}/${file}`;
      await checkPath(abs);
    }
  } else {
    for await (const entry of walk(PKG_DIR, { exts: [".ts", ".tsx"], skip: [/\.test\.tsx?$/, /node_modules/] })) {
      await checkPath(entry.path);
    }
    for await (const entry of walk(EXAMPLE_DIR, { exts: [".ts", ".tsx"], skip: [/\.test\.tsx?$/, /node_modules/, /expo-worker-app/, /bounty-board/] })) {
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
