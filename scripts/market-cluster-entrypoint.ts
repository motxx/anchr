#!/usr/bin/env -S deno run --allow-all
/**
 * Production entrypoint for the prediction-market Fly app.
 *
 * Decrypts the three FROST signer configs from base64-encoded Fly secrets,
 * writes them to /data, spawns the three FROST oracle node processes on
 * 127.0.0.1:4001-4003, then starts the public market server (port 8080).
 *
 * Why one VM instead of three?
 *   For testnet, co-locating signers in the same VM still gives the right
 *   threshold-cryptography guarantees (each share is in a distinct process,
 *   and the FROST signing protocol is enforced). It is intentionally NOT
 *   geographically distributed — that would be the next iteration.
 *
 * Env vars expected (set via `flyctl secrets set`):
 *   FROST_KEY_PASSPHRASE      passphrase for the AES-256-GCM envelope
 *   FROST_SIGNER_1_CONFIG_B64 base64 of the signer-1 config JSON (encrypted)
 *   FROST_SIGNER_2_CONFIG_B64 base64 of signer-2
 *   FROST_SIGNER_3_CONFIG_B64 base64 of signer-3
 *
 * If the FROST secrets are not set, the orchestrator skips the cluster and
 * starts the market server in HTLC-fallback mode so the public site still
 * works while the operator is wiring keys up.
 */

import { existsSync } from "node:fs";

const DATA_DIR = "/data";
const SIGNER_PORTS = [4001, 4002, 4003];

function logTag(tag: string, msg: string): void {
  console.log(`[${tag}] ${msg}`);
}

async function writeSignerConfig(index: 1 | 2 | 3): Promise<string | null> {
  const b64 = Deno.env.get(`FROST_SIGNER_${index}_CONFIG_B64`);
  if (!b64 || b64.trim().length === 0) return null;
  const path = `${DATA_DIR}/signer-${index}.json`;
  try {
    const decoded = atob(b64.trim());
    await Deno.writeTextFile(path, decoded);
    await Deno.chmod(path, 0o600);
    return path;
  } catch (err) {
    logTag("entrypoint", `failed to decode FROST_SIGNER_${index}_CONFIG_B64: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

interface ChildSpec {
  tag: string;
  cmd: string[];
  env: Record<string, string>;
}

function spawnChild(spec: ChildSpec): Deno.ChildProcess {
  const baseEnv = Object.fromEntries(
    Object.entries(Deno.env.toObject()).filter(([k]) => !k.startsWith("FROST_SIGNER_")),
  );
  const child = new Deno.Command(spec.cmd[0]!, {
    args: spec.cmd.slice(1),
    env: { ...baseEnv, ...spec.env },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  logTag("entrypoint", `spawned ${spec.tag} (pid=${child.pid})`);
  return child;
}

async function main() {
  // Make sure the data dir exists (Fly volume).
  try {
    await Deno.mkdir(DATA_DIR, { recursive: true });
  } catch {
    /* already exists */
  }

  // 1. Materialize signer configs from secrets, if provided.
  const configPaths: (string | null)[] = [
    await writeSignerConfig(1),
    await writeSignerConfig(2),
    await writeSignerConfig(3),
  ];
  const haveAllConfigs = configPaths.every((p) => p !== null && existsSync(p));

  const children: Deno.ChildProcess[] = [];

  // 2. If we have all three configs and a passphrase, boot the FROST cluster.
  if (haveAllConfigs && (Deno.env.get("FROST_KEY_PASSPHRASE") ?? "").length > 0) {
    logTag("entrypoint", "FROST configs detected; starting 2-of-3 signer cluster");
    for (let i = 0; i < 3; i++) {
      const port = SIGNER_PORTS[i]!;
      const path = configPaths[i]!;
      children.push(spawnChild({
        tag: `frost-signer-${i + 1}`,
        cmd: [
          "deno", "run", "--allow-all", "--config", "deno.json",
          "scripts/frost-market-oracle-node.ts",
        ],
        env: {
          ORACLE_ID: `frost-market-${i + 1}`,
          ORACLE_PORT: String(port),
          FROST_MARKET_CONFIG_PATH: path,
        },
      }));
    }
  } else {
    logTag(
      "entrypoint",
      haveAllConfigs
        ? "FROST_KEY_PASSPHRASE missing — running market server in HTLC fallback mode"
        : "FROST_SIGNER_*_CONFIG_B64 not all set — running market server in HTLC fallback mode",
    );
  }

  // 3. Start the market server. It points at signer-1.json when present so
  //    its own signer identity is consistent with the cluster's signer-1.
  const marketEnv: Record<string, string> = {
    MARKET_PORT: Deno.env.get("MARKET_PORT") ?? "8080",
  };
  if (haveAllConfigs) {
    marketEnv.FROST_MARKET_CONFIG_PATH = configPaths[0]!;
  } else {
    // Override with empty so server.ts skips frost loading in fallback mode.
    marketEnv.FROST_MARKET_CONFIG_PATH = "";
  }

  children.push(spawnChild({
    tag: "market-server",
    cmd: [
      "deno", "run", "--allow-all", "--config", "deno.json",
      "example/two-party-binary-bet/server.ts",
    ],
    env: marketEnv,
  }));

  // 4. Forward shutdown signals so the Fly machine can stop cleanly.
  const shutdown = () => {
    logTag("entrypoint", "shutting down children");
    for (const c of children) {
      try { c.kill("SIGTERM"); } catch { /* already gone */ }
    }
  };
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  // 5. If any child exits non-zero, exit with that code so Fly restarts the VM.
  const statuses = children.map((c) => c.status);
  const first = await Promise.race(statuses.map((p, i) =>
    p.then((s) => ({ index: i, status: s }))
  ));
  logTag("entrypoint", `child #${first.index + 1} exited (code=${first.status.code}) — terminating VM`);
  shutdown();
  Deno.exit(first.status.code ?? 1);
}

await main();
