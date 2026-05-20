import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(scriptDir, "..", "dist");

const aliases = new Map<string, string>([
  ["@anchr/adapters", "adapters/src/mod.js"],
  ["@anchr/adapters/cashu", "adapters/src/cashu.js"],
  ["@anchr/adapters/nostr", "adapters/src/nostr.js"],
  ["@anchr/adapters/storage", "adapters/src/storage.js"],
  ["@anchr/protocol", "protocol/src/mod.js"],
  ["@anchr/protocol/adapters", "protocol/src/adapters.js"],
  ["@anchr/protocol/capabilities", "protocol/src/capabilities.js"],
  ["@anchr/protocol/events", "protocol/src/events.js"],
  ["@anchr/protocol/nostr", "protocol/src/nostr.js"],
  ["@anchr/protocol/schema", "protocol/src/schema.js"],
  ["@anchr/protocol/types", "protocol/src/types.js"],
  ["@anchr/oracle-sdk", "oracle-sdk/src/mod.js"],
  ["@anchr/oracle-sdk/oracle", "oracle-sdk/src/oracle.js"],
  ["@anchr/customer-sdk", "customer-sdk/src/mod.js"],
  ["@anchr/customer-sdk/customer", "customer-sdk/src/customer.js"],
  ["@anchr/customer-sdk/types", "customer-sdk/src/types.js"],
  ["@anchr/provider-sdk", "provider-sdk/src/mod.js"],
  ["@anchr/provider-sdk/provider", "provider-sdk/src/provider.js"],
  ["@anchr/provider-sdk/types", "provider-sdk/src/types.js"],
]);

async function dtsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await dtsFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

function relativeSpecifier(fromFile: string, distTarget: string): string {
  const fromDir = dirname(fromFile);
  const absoluteTarget = join(distDir, distTarget);
  let specifier = relative(fromDir, absoluteTarget).replaceAll("\\", "/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}

function rewriteWorkspaceAliases(path: string, source: string): string {
  let rewritten = source;
  for (const [alias, target] of aliases) {
    const specifier = relativeSpecifier(path, target);
    rewritten = rewritten.replaceAll(`"${alias}"`, `"${specifier}"`);
    rewritten = rewritten.replaceAll(`'${alias}'`, `'${specifier}'`);
  }
  return rewritten;
}

for (const path of await dtsFiles(distDir)) {
  const source = await readFile(path, "utf8");
  const rewritten = rewriteWorkspaceAliases(
    path,
    source.replaceAll(
      /((?:from|import)\s*\(?\s*["']\.\/[^"']+)\.ts(["'])/g,
      "$1.js$2",
    ),
  );
  if (rewritten !== source) {
    await writeFile(path, rewritten);
  }
}
