#!/usr/bin/env -S deno run --allow-read --allow-run
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;
const SOURCE_EXTS = /\.(ts|tsx)$/;
const SANITIZER_BYPASS =
  /\b(sanitizeOps|sanitizeResources|sanitizeExit)\s*:\s*false\b/;

const SELF_EXEMPT = new Set([
  "scripts/lint-no-test-sanitizer-bypass.ts",
  "scripts/lint-no-test-sanitizer-bypass.test.ts",
]);

export interface Hit {
  file: string;
  line: number;
  text: string;
  option: string;
}

export function scanText(text: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(SANITIZER_BYPASS);
    if (!match) continue;
    hits.push({
      file,
      line: i + 1,
      text: line.trim(),
      option: match[1],
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

export async function scanRepo(root = ROOT): Promise<Hit[]> {
  const cmd = new Deno.Command("git", {
    args: ["ls-files", "-co", "--exclude-standard", "-z"],
    cwd: root,
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
    .filter((name) => SOURCE_EXTS.test(name));

  const hits: Hit[] = [];
  for (const name of names) {
    hits.push(...(await scanFile(`${root}${name}`)));
  }
  return hits;
}

function report(hits: Hit[]): void {
  if (hits.length === 0) {
    console.log("no disabled Deno test sanitizers detected");
    return;
  }

  console.error(`disabled Deno test sanitizer: ${hits.length} hit(s)\n`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}`);
    console.error(`      ${hit.text}`);
  }
  console.error(
    "\nKeep Deno test sanitizers enabled. Fix open resources, pending ops, " +
      "or process exits in the test instead of setting a sanitizer option " +
      "to false.",
  );
}

if (import.meta.main) {
  const hits = await scanRepo();
  report(hits);
  if (hits.length > 0) Deno.exit(1);
}
