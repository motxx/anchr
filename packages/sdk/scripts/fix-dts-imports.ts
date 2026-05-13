import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(scriptDir, "..", "dist");
const files = await readdir(distDir);

for (const file of files) {
  if (!file.endsWith(".d.ts")) continue;
  const path = join(distDir, file);
  const source = await readFile(path, "utf8");
  const rewritten = source.replaceAll(
    /((?:from|import)\s*\(?\s*["']\.\/[^"']+)\.ts(["'])/g,
    "$1.js$2",
  );
  if (rewritten !== source) {
    await writeFile(path, rewritten);
  }
}
