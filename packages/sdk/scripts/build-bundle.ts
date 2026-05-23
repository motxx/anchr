import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

interface BunBuildPlugin {
  name: string;
  setup(build: BunBuildHandle): void;
}

interface BunBuildHandle {
  onResolve(
    options: { filter: RegExp },
    callback: (args: { path: string }) => { path: string } | undefined,
  ): void;
}

interface BunBuildConfig {
  entrypoints: readonly string[];
  outdir: string;
  target: "node";
  plugins: readonly BunBuildPlugin[];
}

interface BunBuildResult {
  success: boolean;
  logs: readonly unknown[];
}

declare const Bun: {
  build(config: BunBuildConfig): Promise<BunBuildResult>;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");

const aliases = new Map<string, string>([
  ["@anchr/adapters", "../adapters/src/mod.ts"],
  ["@anchr/adapters/cashu", "../adapters/src/cashu.ts"],
  ["@anchr/adapters/nostr", "../adapters/src/nostr.ts"],
  ["@anchr/adapters/storage", "../adapters/src/storage.ts"],
  ["@anchr/protocol", "../protocol/src/mod.ts"],
  ["@anchr/protocol/adapters", "../protocol/src/adapters.ts"],
  ["@anchr/protocol/capabilities", "../protocol/src/capabilities.ts"],
  ["@anchr/protocol/events", "../protocol/src/events.ts"],
  ["@anchr/protocol/nostr", "../protocol/src/nostr.ts"],
  ["@anchr/protocol/schema", "../protocol/src/schema.ts"],
  ["@anchr/protocol/types", "../protocol/src/types.ts"],
]);

const result = await Bun.build({
  entrypoints: [
    resolve(packageDir, "src/index.ts"),
    resolve(packageDir, "src/customer.ts"),
    resolve(packageDir, "src/provider.ts"),
    resolve(packageDir, "src/oracle.ts"),
  ],
  outdir: resolve(packageDir, "dist"),
  target: "node",
  plugins: [
    {
      name: "anchr-workspace-aliases",
      setup(build) {
        build.onResolve({ filter: /^@anchr\// }, (args) => {
          const target = aliases.get(args.path);
          if (!target) return undefined;
          return { path: resolve(packageDir, target) };
        });
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) {
    process.stderr.write(`${log}\n`);
  }
  process.exit(1);
}
