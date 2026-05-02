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
const MARKET_UI = join(PROJECT_ROOT, "example/two-party-binary-bet/ui");

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

const WATCH = Deno.args.includes("--watch");

async function copyHtmlAndCss(entry: EntryPoint) {
  const { srcDir, outDir, html: htmlName } = entry;
  const htmlSrc = join(srcDir, htmlName);
  let html = await readFile(htmlSrc, "utf-8");
  const rewritten = html.replace(/src="\.\/main\.tsx"/g, 'src="./main.js"');
  if (rewritten !== html || srcDir !== outDir) {
    html = rewritten;
    await writeFile(join(outDir, htmlName), html);
  }
  if (srcDir !== outDir) {
    try {
      await copyFile(join(srcDir, "generated.css"), join(outDir, "generated.css"));
    } catch {
      // generated.css may not exist yet — created by build:css.
    }
  }
}

async function buildEntry(entry: EntryPoint) {
  const { srcDir, outDir, entryTsx, name } = entry;
  await mkdir(outDir, { recursive: true });

  const buildOptions = {
    entryPoints: [join(srcDir, entryTsx)],
    bundle: true,
    outfile: join(outDir, "main.js"),
    format: "esm" as const,
    platform: "browser" as const,
    target: "es2022",
    jsx: "automatic" as const,
    jsxImportSource: "react",
    loader: { ".tsx": "tsx" as const, ".ts": "ts" as const, ".css": "css" as const },
    minify: !WATCH,
    sourcemap: true,
    define: {
      "process.env.NODE_ENV": WATCH ? '"development"' : '"production"',
    },
  };

  if (WATCH) {
    const ctx = await esbuild.context({
      ...buildOptions,
      plugins: [
        {
          name: "kannagi-watch-log",
          setup(build) {
            build.onEnd(async (result) => {
              if (result.errors.length > 0) {
                console.error(`[build-ui:${name}] ${result.errors.length} error(s)`);
              } else {
                await copyHtmlAndCss(entry);
                console.log(`[build-ui:${name}] rebuilt → ${outDir}/main.js`);
              }
            });
          },
        },
      ],
    });
    await ctx.watch();
  } else {
    await esbuild.build(buildOptions);
    await copyHtmlAndCss(entry);
    console.log(`[build-ui] ${name}: ${outDir}`);
  }
}

async function main() {
  console.log(WATCH ? "[build-ui] Watching..." : "[build-ui] Building UI bundles...");
  await mkdir(DIST_UI, { recursive: true });

  await Promise.all(ENTRIES.map(buildEntry));

  // Copy shared assets (fonts, images) if any exist
  try {
    await cp(join(SRC_UI, "assets"), join(DIST_UI, "assets"), { recursive: true });
  } catch {
    // No assets directory
  }

  if (WATCH) {
    console.log("[build-ui] Watching all entries — Ctrl+C to stop.");
    // Keep the process alive — esbuild contexts are watching.
    await new Promise(() => {});
  } else {
    await esbuild.stop();
    console.log("[build-ui] Done.");
  }
}

await main();
