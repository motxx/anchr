#!/usr/bin/env -S deno run --allow-read --allow-run
/**
 * Deno formatter gate.
 *
 * `deno fmt --check` scans Markdown by default. Project docs are edited as
 * prose, so this lint enumerates only source files and Deno config files before
 * delegating to the formatter.
 */

const ROOT = new URL("../", import.meta.url).pathname;
const CHUNK_SIZE = 120;

const EXCLUDED_PREFIXES = [
  ".claude/skills/",
  ".codex/skills/",
  "docs/",
  "apps/expo-worker-app/",
  "node_modules/",
  "skills/",
];

const EXCLUDED_SUFFIXES = [
  ".lock",
  ".md",
];

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".jsonc",
];

export function shouldCheckFormat(path: string): boolean {
  if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false;
  }
  if (EXCLUDED_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
    return false;
  }
  if (path === "deno.json" || path.endsWith("/deno.json")) return true;
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

async function listTrackedFiles(): Promise<string[]> {
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
  return new TextDecoder()
    .decode(stdout)
    .split("\0")
    .filter(Boolean)
    .filter(shouldCheckFormat);
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function checkChunk(files: string[]): Promise<number> {
  const cmd = new Deno.Command("deno", {
    args: ["fmt", "--check", "--config", "deno.json", ...files],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  return code;
}

export async function lintFormat(): Promise<number> {
  const files = await listTrackedFiles();
  if (files.length === 0) {
    console.log("✓ deno fmt check passed (0 files)");
    return 0;
  }

  for (const filesChunk of chunk(files, CHUNK_SIZE)) {
    const code = await checkChunk(filesChunk);
    if (code !== 0) return code;
  }

  console.log(`✓ deno fmt check passed (${files.length} files)`);
  return 0;
}

if (import.meta.main) {
  Deno.exit(await lintFormat());
}
