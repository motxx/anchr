import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");

const aliases = new Map<string, string>([
  ["@anchr/protocol", "../protocol/src/mod.ts"],
  ["@anchr/protocol/events", "../protocol/src/events.ts"],
  ["@anchr/protocol/nostr", "../protocol/src/nostr.ts"],
  ["@anchr/protocol/schema", "../protocol/src/schema.ts"],
  ["@anchr/protocol/types", "../protocol/src/types.ts"],
  ["@anchr/oracle-sdk", "../oracle-sdk/src/mod.ts"],
  ["@anchr/oracle-sdk/oracle", "../oracle-sdk/src/oracle.ts"],
  ["@anchr/customer-sdk", "../customer-sdk/src/mod.ts"],
  ["@anchr/customer-sdk/cashu", "../customer-sdk/src/cashu.ts"],
  ["@anchr/customer-sdk/customer", "../customer-sdk/src/customer.ts"],
  ["@anchr/customer-sdk/nostr", "../customer-sdk/src/nostr.ts"],
  ["@anchr/customer-sdk/types", "../customer-sdk/src/types.ts"],
  ["@anchr/provider-sdk", "../provider-sdk/src/mod.ts"],
  ["@anchr/provider-sdk/cashu", "../provider-sdk/src/cashu.ts"],
  ["@anchr/provider-sdk/nostr", "../provider-sdk/src/nostr.ts"],
  ["@anchr/provider-sdk/provider", "../provider-sdk/src/provider.ts"],
  ["@anchr/provider-sdk/types", "../provider-sdk/src/types.ts"],
]);

const result = await Bun.build({
  entrypoints: [resolve(packageDir, "src/index.ts")],
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
