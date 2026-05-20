#!/usr/bin/env -S deno run --allow-read
/**
 * Architecture-review candidate picker.
 *
 * Lists the largest non-test files per layer, package, app, and example so the
 * `arch-lint-llm` skill (semantic review) can focus on the files most
 * likely to harbour cohesion / locator / leak smells. Pure selection;
 * no analysis happens here.
 *
 * Usage:
 *   deno task lint:arch:candidates                 # top-N per layer
 *   deno task lint:arch:candidates -- --full       # every non-test file in scope
 *   deno task lint:arch:candidates -- --layer infrastructure
 *
 * The static `deno task lint:arch` complements this: the candidate picker
 * selects, the structural lint enforces, and the LLM skill reads files
 * out of the candidate list for L001-L006 review.
 */
import { walk } from "jsr:@std/fs@^1/walk";
import { relative } from "jsr:@std/path@^1";

const ROOT = new URL("../", import.meta.url).pathname;

const SRC_LAYERS = ["domain", "application", "infrastructure"] as const;
const TOP_PER_LAYER = 4;

interface Candidate {
  rel: string;
  lines: number;
}

async function listLayer(
  absDir: string,
  layerLabel: string,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  try {
    for await (
      const entry of walk(absDir, {
        exts: [".ts", ".tsx"],
        skip: [/\.test\.tsx?$/, /node_modules/],
      })
    ) {
      const text = await Deno.readTextFile(entry.path);
      const rel = relative(ROOT, entry.path);
      out.push({ rel, lines: text.split("\n").length });
    }
  } catch {
    // Layer directory may not exist (e.g., src/ui/ deleted). Skip silently.
  }
  out.sort((a, b) => b.lines - a.lines);
  return out.map((c) => ({ ...c, rel: c.rel || layerLabel }));
}

async function main() {
  const args = Deno.args;
  const full = args.includes("--full");
  const layerArg = args.find((a, i, all) => all[i - 1] === "--layer");

  async function workspaceGroups(
    topDir: string,
    childDir = "src",
  ): Promise<{ label: string; absDir: string }[]> {
    const out: { label: string; absDir: string }[] = [];
    try {
      for await (const entry of Deno.readDir(`${ROOT}${topDir}`)) {
        if (!entry.isDirectory) continue;
        const label = `${topDir}/${entry.name}/${childDir}/`;
        out.push({
          label,
          absDir: `${ROOT}${topDir}/${entry.name}/${childDir}`,
        });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }

  const groups: { label: string; absDir: string }[] = [
    ...SRC_LAYERS.map((l) => ({
      label: `src/${l}/`,
      absDir: `${ROOT}src/${l}`,
    })),
    ...(await workspaceGroups("packages")),
    ...(await workspaceGroups("apps")),
    ...(await workspaceGroups("examples")),
  ];

  const filtered = layerArg
    ? groups.filter((g) => g.label.includes(layerArg))
    : groups;

  for (const g of filtered) {
    const cands = await listLayer(g.absDir, g.label);
    if (cands.length === 0) continue;
    const picked = full ? cands : cands.slice(0, TOP_PER_LAYER);
    console.log(`# ${g.label} — ${picked.length} candidate(s)`);
    for (const c of picked) {
      console.log(`  ${c.lines.toString().padStart(5)}  ${c.rel}`);
    }
    console.log();
  }
}

if (import.meta.main) {
  await main();
}
