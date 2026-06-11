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
 *   [E026] sdk feature folders may touch request internals only through
 *          documented request-scoped lifecycle state or lifecycle ports.
 *   [E027] Nostr event-kind constants are owned by @anchr/protocol/nostr;
 *          the sdk package must import them, never define them.
 *   [E028] direct env reads are confined to documented config-resolution
 *          surfaces; library modules take config through options/deps.
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
  /\b(market|marketplace|markets|marketplaces|Market|Marketplace|Markets|Marketplaces|MARKET|MARKETPLACE|bounty|bounties|Bounty|Bounties|BOUNTY)\b/;
// [E027] Nostr event-kind constants are owned by @anchr/protocol/nostr.
// Defining a numeric kind constant in the sdk package re-creates a second
// wire-contract owner.
const SDK_KIND_CONST = /\bexport\s+const\s+(KIND_|ANCHR_)[A-Z_0-9]+\s*=\s*\d+/;
// [E028] Direct env reads are confined to documented config-resolution
// surfaces; library modules take config through options/deps instead.
const ENV_READ = /\bDeno\.env\.get\b/;
const ENV_READ_ALLOWED: readonly string[] = [
  "packages/sdk/src/internal/runtime/",
  "packages/sdk/src/testing/helpers.ts",
  "packages/sdk/src/adapters/nostr/oracle-service.ts",
  "packages/sdk/src/adapters/oracle-client/config-loader.ts",
  "packages/sdk/src/adapters/oracle-service/server.ts",
  "packages/sdk/src/attachments/access.ts",
  "packages/sdk/src/attachments/blossom.ts",
  "packages/sdk/src/attachments/url-validation.ts",
  "packages/sdk/src/payments/cashu/cashu-wallet.ts",
  "packages/sdk/src/proofs/verification/checks/ai-content.ts",
];

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

function resolveRelativeImportTarget(
  specifier: string,
  fileRel: string,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const fileParts = fileRel.split("/").slice(0, -1);
  const specParts = specifier.split("/");
  const merged: string[] = [...fileParts];
  for (const p of specParts) {
    if (p === "." || p === "") continue;
    if (p === "..") merged.pop();
    else merged.push(p);
  }
  return merged.join("/");
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

function isAllowedSdkRequestImport(
  fileRel: string,
  targetRel: string,
): boolean {
  if (!fileRel.startsWith("packages/sdk/src/")) return true;
  if (fileRel.startsWith("packages/sdk/src/requests/")) return true;
  if (!targetRel.startsWith("packages/sdk/src/requests/")) return true;

  const allowedByImporter: Array<{
    importer: string;
    targets: readonly string[];
  }> = [
    {
      importer: "packages/sdk/src/attachments/",
      targets: ["packages/sdk/src/requests/domain/types.ts"],
    },
    {
      importer: "packages/sdk/src/customer.ts",
      targets: ["packages/sdk/src/requests/domain/ports.ts"],
    },
    {
      importer: "packages/sdk/src/index.ts",
      targets: ["packages/sdk/src/requests/domain/ports.ts"],
    },
    {
      importer: "packages/sdk/src/customer-types.ts",
      targets: ["packages/sdk/src/requests/domain/ports.ts"],
    },
    {
      importer: "packages/sdk/src/provider.ts",
      targets: ["packages/sdk/src/requests/domain/ports.ts"],
    },
    {
      importer: "packages/sdk/src/provider-types.ts",
      targets: ["packages/sdk/src/requests/domain/ports.ts"],
    },
    {
      importer: "packages/sdk/src/payments/",
      targets: [
        "packages/sdk/src/requests/application/ports.ts",
        "packages/sdk/src/requests/domain/types.ts",
      ],
    },
    {
      importer: "packages/sdk/src/proofs/",
      targets: ["packages/sdk/src/requests/domain/types.ts"],
    },
    {
      importer: "packages/sdk/src/adapters/nostr/",
      targets: [
        "packages/sdk/src/requests/application/ports.ts",
        "packages/sdk/src/requests/domain/oracle-types.ts",
        "packages/sdk/src/requests/domain/types.ts",
      ],
    },
    {
      importer: "packages/sdk/src/adapters/oracle-client/",
      targets: [
        "packages/sdk/src/requests/application/ports.ts",
        "packages/sdk/src/requests/domain/oracle-types.ts",
        "packages/sdk/src/requests/domain/types.ts",
      ],
    },
    {
      importer: "packages/sdk/src/adapters/oracle-service/",
      targets: [
        "packages/sdk/src/requests/domain/oracle-types.ts",
        "packages/sdk/src/requests/domain/types.ts",
      ],
    },
    {
      importer: "packages/sdk/src/testing/",
      targets: [
        "packages/sdk/src/requests/application/ports.ts",
        "packages/sdk/src/requests/application/query-escrow-validation.ts",
        "packages/sdk/src/requests/application/query-service.ts",
        "packages/sdk/src/requests/domain/oracle-types.ts",
        "packages/sdk/src/requests/domain/types.ts",
      ],
    },
  ];

  return allowedByImporter.some((rule) =>
    fileRel.startsWith(rule.importer) && rule.targets.includes(targetRel)
  );
}

function isAllowedRequestFeatureImport(
  fileRel: string,
  targetRel: string,
): boolean {
  if (!fileRel.startsWith("packages/sdk/src/requests/")) return true;
  if (!targetRel.startsWith("packages/sdk/src/")) return true;
  if (targetRel.startsWith("packages/sdk/src/requests/")) return true;

  const featureTargets = [
    "packages/sdk/src/adapters/",
    "packages/sdk/src/attachments/",
    "packages/sdk/src/payments/",
    "packages/sdk/src/proofs/",
  ];
  if (!featureTargets.some((prefix) => targetRel.startsWith(prefix))) {
    return true;
  }

  if (
    fileRel.startsWith("packages/sdk/src/requests/") &&
    targetRel === "packages/sdk/src/proofs/mod.ts"
  ) {
    return true;
  }

  return false;
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

  if (pkg === "sdk") {
    for (const hit of scanContentLines(source, SDK_KIND_CONST)) {
      violations.push({
        file: fileRel,
        line: hit.line,
        code: "E027",
        severity: "error",
        message:
          `Nostr kind constant defined in sdk; import it from @anchr/protocol/nostr instead`,
      });
    }
    if (
      !fileRel.endsWith(".test.ts") &&
      !ENV_READ_ALLOWED.some((allowed) => fileRel.startsWith(allowed))
    ) {
      for (const hit of scanContentLines(source, ENV_READ)) {
        violations.push({
          file: fileRel,
          line: hit.line,
          code: "E028",
          severity: "error",
          message:
            `direct env read outside the documented config surfaces; take config through options/deps`,
        });
      }
    }
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

  if (pkg === "sdk") {
    for (const { specifier, line } of extractImports(source)) {
      const target = resolveRelativeImportTarget(specifier, fileRel);
      if (!target) continue;
      if (
        !isAllowedSdkRequestImport(fileRel, target) ||
        !isAllowedRequestFeatureImport(fileRel, target)
      ) {
        violations.push({
          file: fileRel,
          line,
          code: "E026",
          severity: "error",
          message:
            `SDK request internals may be imported only through documented request-scoped state or lifecycle ports (found "${specifier}")`,
        });
      }
    }
  }

  return violations;
}

export {
  checkPackageFile,
  isAllowedRequestFeatureImport,
  isAllowedSdkRequestImport,
  resolveRelativeImportTarget,
};

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
