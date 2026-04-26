/**
 * Build UI bundles for Deno static serving.
 *
 * Bundles 3 React entry points (worker, requester, dashboard) with esbuild,
 * copies HTML files with <script src="./main.tsx"> rewritten to <script src="./main.js">.
 *
 * Output: dist/ui/
 */

import * as esbuild from "esbuild";
import { join, dirname } from "node:path";
import { copyFile, mkdir, readFile, writeFile, cp } from "node:fs/promises";

const PROJECT_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const SRC_UI = join(PROJECT_ROOT, "src/ui");
const DIST_UI = join(PROJECT_ROOT, "dist/ui");
const MARKET_UI = join(PROJECT_ROOT, "example/prediction-market/ui");

interface EntryPoint {
  name: string;
  /** Source directory containing the entry tsx + html. */
  srcDir: string;
  /** Output directory for bundled main.js + index.html. */
  outDir: string;
  entryTsx: string;
  html: string;
}

const ENTRIES: EntryPoint[] = [
  { name: "worker",    srcDir: SRC_UI,                       outDir: DIST_UI,                          entryTsx: "main.tsx", html: "index.html" },
  { name: "requester", srcDir: join(SRC_UI, "requester"),    outDir: join(DIST_UI, "requester"),       entryTsx: "main.tsx", html: "index.html" },
  { name: "dashboard", srcDir: join(SRC_UI, "dashboard"),    outDir: join(DIST_UI, "dashboard"),       entryTsx: "main.tsx", html: "index.html" },
  // Market UI is bundled in-place (server.ts serves directly from the source dir).
  { name: "market",    srcDir: MARKET_UI,                    outDir: MARKET_UI,                        entryTsx: "main.tsx", html: "index.html" },
];

async function buildEntry(entry: EntryPoint) {
  const srcDir = entry.srcDir;
  const outDir = entry.outDir;
  await mkdir(outDir, { recursive: true });

  // Bundle TSX → JS
  await esbuild.build({
    entryPoints: [join(srcDir, entry.entryTsx)],
    bundle: true,
    outfile: join(outDir, "main.js"),
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    loader: { ".tsx": "tsx", ".ts": "ts", ".css": "css" },
    minify: true,
    sourcemap: true,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  // Copy + rewrite HTML
  const htmlSrc = join(srcDir, entry.html);
  let html = await readFile(htmlSrc, "utf-8");
  html = html.replace(/src="\.\/main\.tsx"/g, 'src="./main.js"');
  await writeFile(join(outDir, entry.html), html);

  // Copy generated.css if it exists
  try {
    await copyFile(join(srcDir, "generated.css"), join(outDir, "generated.css"));
  } catch {
    // generated.css may not exist yet — will be created by build:css
  }

  console.log(`[build-ui] ${entry.name}: ${outDir}`);
}

async function main() {
  console.log("[build-ui] Building UI bundles...");
  await mkdir(DIST_UI, { recursive: true });

  await Promise.all(ENTRIES.map(buildEntry));

  // Copy shared assets (fonts, images) if any exist
  try {
    await cp(join(SRC_UI, "assets"), join(DIST_UI, "assets"), { recursive: true });
  } catch {
    // No assets directory
  }

  await esbuild.stop();
  console.log("[build-ui] Done.");
}

await main();
