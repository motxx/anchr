#!/usr/bin/env -S deno run --allow-all
/**
 * One-shot helper for the operator: run DKG, encrypt the signer configs,
 * and emit the exact `flyctl secrets set` commands needed to deploy the
 * FROST 2-of-3 cluster on Fly.
 *
 * Run locally (frost-signer binary required):
 *   FROST_KEY_PASSPHRASE=$(openssl rand -hex 32) \
 *     deno run --allow-all scripts/frost-market-prepare-secrets.ts
 *
 * The script writes the encrypted configs to .frost-market/signer-{1..3}.json
 * (mode 0600) and prints, on stdout, the `flyctl secrets set` invocation
 * that uploads them as base64-encoded env vars to the Fly app.
 *
 * Re-running rotates keys; the operator is responsible for restarting any
 * markets that were created under the old group pubkeys.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const APP_NAME = Deno.args.includes("--app")
  ? Deno.args[Deno.args.indexOf("--app") + 1]!
  : "anchr-market";
const OUTPUT_DIR = ".frost-market";
const THRESHOLD = 2;
const TOTAL = 3;
const BASE_PORT = 4001; // the cluster listens on 127.0.0.1:4001-4003 inside the VM

const passphrase = Deno.env.get("FROST_KEY_PASSPHRASE")?.trim();
if (!passphrase) {
  console.error("ERROR: FROST_KEY_PASSPHRASE must be set (32+ hex chars recommended).");
  console.error("       Generate one with: openssl rand -hex 32");
  Deno.exit(1);
}

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

console.log(`[prepare-secrets] Running ${THRESHOLD}-of-${TOTAL} DKG (output: ${OUTPUT_DIR}/)`);

const dkg = new Deno.Command("deno", {
  args: [
    "run", "--allow-all", "--config", "deno.json",
    "scripts/frost-market-dkg-bootstrap.ts",
    "--threshold", String(THRESHOLD),
    "--total", String(TOTAL),
    "--output-dir", OUTPUT_DIR,
    "--base-port", String(BASE_PORT),
  ],
  env: { ...Deno.env.toObject(), FROST_KEY_PASSPHRASE: passphrase },
  stdout: "inherit",
  stderr: "inherit",
});
const { code } = await dkg.output();
if (code !== 0) {
  console.error("[prepare-secrets] DKG bootstrap failed");
  Deno.exit(code);
}

// Read each encrypted signer config and base64-encode for Fly secrets.
const b64s: string[] = [];
for (let i = 1; i <= TOTAL; i++) {
  const path = join(OUTPUT_DIR, `signer-${i}.json`);
  const raw = await Deno.readFile(path);
  b64s.push(encodeBase64(raw));
}

console.log(`
==============================================================
  FROST DKG complete. Encrypted configs are in ${OUTPUT_DIR}/
==============================================================

Next: upload the configs + passphrase to Fly. Copy-paste the
following block to your shell (or pipe into 'sh -'):

flyctl secrets set --app ${APP_NAME} \\
  FROST_KEY_PASSPHRASE='${passphrase}' \\
  FROST_SIGNER_1_CONFIG_B64='${b64s[0]}' \\
  FROST_SIGNER_2_CONFIG_B64='${b64s[1]}' \\
  FROST_SIGNER_3_CONFIG_B64='${b64s[2]}'

After uploading, deploy with:

  flyctl deploy --remote-only --config fly.market.toml

The orchestrator (scripts/market-cluster-entrypoint.ts) decrypts the
configs at boot, spawns the FROST cluster on 127.0.0.1:4001-4003,
and starts the market server on :8080.

KEEP THE PASSPHRASE SAFE. Losing it makes the DKG output undecryptable.
==============================================================`);
