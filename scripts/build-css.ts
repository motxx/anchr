/**
 * Build CSS with Tailwind CLI.
 *
 * Replaces: bunx @tailwindcss/cli -i <input> -o <output>
 */

import { dirname, join } from "node:path";

const PROJECT_ROOT = dirname(dirname(new URL(import.meta.url).pathname));

interface CssBuild {
  label: string;
  input: string;
  output: string;
}

const BUILDS: CssBuild[] = [
  {
    label: "worker",
    input: join(PROJECT_ROOT, "src/ui/globals.css"),
    output: join(PROJECT_ROOT, "src/ui/generated.css"),
  },
  {
    label: "requester",
    input: join(PROJECT_ROOT, "src/ui/requester/globals.css"),
    output: join(PROJECT_ROOT, "src/ui/requester/generated.css"),
  },
  {
    label: "dashboard",
    input: join(PROJECT_ROOT, "src/ui/dashboard/globals.css"),
    output: join(PROJECT_ROOT, "src/ui/dashboard/generated.css"),
  },
];

async function buildCss(build: CssBuild) {
  console.log(`[build-css:${build.label}] ${build.input} → ${build.output}`);
  const cmd = new Deno.Command("npx", {
    args: ["@tailwindcss/cli", "-i", build.input, "-o", build.output],
    stdout: "inherit",
    stderr: "inherit",
  });
  const result = await cmd.output();
  if (!result.success) {
    console.error(`[build-css:${build.label}] Failed (exit ${result.code})`);
    Deno.exit(1);
  }
}

console.log("[build-css] Building CSS...");
await Promise.all(BUILDS.map(buildCss));
console.log("[build-css] Done.");
