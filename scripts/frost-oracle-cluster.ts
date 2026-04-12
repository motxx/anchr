#!/usr/bin/env -S deno run --allow-all
/**
 * FROST Oracle Cluster — starts 3 Oracle nodes with FROST threshold signing.
 *
 * Prerequisites:
 *   deno run --allow-all scripts/frost-dkg-bootstrap.ts
 *
 * Usage:
 *   deno run --allow-all scripts/frost-oracle-cluster.ts [--config-dir .frost]
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const CONFIG_DIR = Deno.args.includes("--config-dir")
  ? Deno.args[Deno.args.indexOf("--config-dir") + 1]!
  : ".frost";

const API_KEY = Deno.args.includes("--api-key")
  ? Deno.args[Deno.args.indexOf("--api-key") + 1]!
  : "frost-shared-key";

async function main() {
  // Discover signer configs
  const configs: string[] = [];
  for (let i = 1; ; i++) {
    const path = join(CONFIG_DIR, `signer-${i}.json`);
    if (!existsSync(path)) break;
    configs.push(path);
  }

  if (configs.length === 0) {
    console.error(`No signer configs found in ${CONFIG_DIR}/`);
    console.error("Run: deno run --allow-all scripts/frost-dkg-bootstrap.ts");
    Deno.exit(1);
  }

  console.log(`Starting ${configs.length} Oracle nodes...`);

  const processes: Deno.ChildProcess[] = [];

  for (let i = 0; i < configs.length; i++) {
    const configPath = configs[i]!;
    const config = JSON.parse(Deno.readTextFileSync(configPath));
    const port = config.peers[i]?.endpoint
      ? new URL(config.peers[i].endpoint).port
      : String(4001 + i);

    console.log(`  Signer ${i + 1}: port ${port}, config ${configPath}`);

    const child = new Deno.Command("deno", {
      args: [
        "run", "--allow-all", "--env",
        "src/infrastructure/oracle/oracle-server.ts",
      ],
      env: {
        ...Object.fromEntries(Object.entries(Deno.env.toObject())),
        ORACLE_ID: `frost-oracle-${i + 1}`,
        ORACLE_PORT: port,
        ORACLE_API_KEY: API_KEY,
        FROST_CONFIG_PATH: configPath,
      },
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();

    processes.push(child);
  }

  console.log(`\n${configs.length} Oracle nodes started. Press Ctrl+C to stop.\n`);

  // Wait for Ctrl+C
  Deno.addSignalListener("SIGINT", () => {
    console.log("\nShutting down...");
    for (const p of processes) {
      try { p.kill(); } catch { /* already dead */ }
    }
    Deno.exit(0);
  });

  // Keep alive
  await Promise.all(processes.map(p => p.status));
}

main().catch((e) => { console.error(e); Deno.exit(1); });
