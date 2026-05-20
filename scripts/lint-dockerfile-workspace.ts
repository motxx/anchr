#!/usr/bin/env -S deno run --allow-read
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;

export interface Diff {
  missing: string[];
  extra: string[];
}

const COPY_RE = /^\s*COPY\s+(\S+)\/deno\.json\s+\.\/\1\/\s*$/;

export function diffWorkspace(
  workspace: readonly string[],
  dockerfile: string,
): Diff {
  const declared = new Set(workspace.map((p) => p.replace(/^\.\//, "")));
  const copied = new Set<string>();
  for (const line of dockerfile.split("\n")) {
    const m = line.match(COPY_RE);
    if (m) copied.add(m[1]);
  }
  const missing = [...declared].filter((p) => !copied.has(p)).sort();
  const extra = [...copied].filter((p) => !declared.has(p)).sort();
  return { missing, extra };
}

interface RootConfig {
  workspace?: string[];
}

export async function loadFromRepo(root = ROOT): Promise<Diff> {
  const denoJsonPath = `${root}deno.json`;
  const dockerfilePath = `${root}Dockerfile`;
  const config = JSON.parse(
    await Deno.readTextFile(denoJsonPath),
  ) as RootConfig;
  const dockerfile = await Deno.readTextFile(dockerfilePath);
  return diffWorkspace(config.workspace ?? [], dockerfile);
}

function report(diff: Diff): void {
  if (diff.missing.length === 0 && diff.extra.length === 0) {
    console.log("✓ Dockerfile workspace COPY matches deno.json workspace");
    return;
  }
  console.error(
    "✗ Dockerfile / deno.json workspace mismatch\n" +
      "  (the Dockerfile must COPY <path>/deno.json before `RUN deno install`\n" +
      "   for every workspace member declared in the root deno.json)\n",
  );
  for (const p of diff.missing) {
    console.error(
      `  missing COPY:  ${relative(ROOT, `${ROOT}Dockerfile`)} is missing ` +
        `\`COPY ${p}/deno.json ./${p}/\``,
    );
  }
  for (const p of diff.extra) {
    console.error(
      `  stale COPY:    \`COPY ${p}/deno.json ...\` is in Dockerfile ` +
        `but ${p} is not a workspace member in deno.json`,
    );
  }
}

if (import.meta.main) {
  const diff = await loadFromRepo();
  report(diff);
  if (diff.missing.length > 0 || diff.extra.length > 0) Deno.exit(1);
}
