#!/usr/bin/env -S deno run --allow-all
/**
 * FROST DKG Bootstrap — generates key material for a threshold Oracle cluster.
 *
 * Usage:
 *   deno run --allow-all scripts/frost-dkg-bootstrap.ts [--threshold 2] [--total 3] [--output-dir .frost]
 *
 * Produces:
 *   .frost/signer-1.json
 *   .frost/signer-2.json
 *   .frost/signer-3.json
 *
 * Each file contains the FrostNodeConfig for that signer.
 */

import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  dkgRound1,
  dkgRound2,
  dkgRound3,
  isFrostSignerAvailable,
} from "../src/infrastructure/frost/frost-cli.ts";
import type { FrostNodeConfig, PeerConfig } from "../src/infrastructure/frost/config.ts";

// --- Parse CLI args ---
interface ParsedArgs {
  threshold?: number;
  total?: number;
  outputDir?: string;
  basePort?: number;
  apiKey?: string;
}

function parseArgs(raw: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--threshold") result.threshold = Number(raw[++i]);
    else if (raw[i] === "--total") result.total = Number(raw[++i]);
    else if (raw[i] === "--output-dir") result.outputDir = raw[++i]!;
    else if (raw[i] === "--base-port") result.basePort = Number(raw[++i]);
    else if (raw[i] === "--api-key") result.apiKey = raw[++i]!;
  }
  return result;
}

const args = parseArgs(Deno.args);
const THRESHOLD = args.threshold ?? 2;
const TOTAL = args.total ?? 3;
const OUTPUT_DIR = args.outputDir ?? ".frost";
const BASE_PORT = args.basePort ?? 4001;
const API_KEY = args.apiKey ?? "frost-shared-key";

async function main() {
  console.log(`FROST DKG Bootstrap: ${THRESHOLD}-of-${TOTAL}`);
  console.log(`Output: ${OUTPUT_DIR}/signer-{1..${TOTAL}}.json`);

  if (!isFrostSignerAvailable()) {
    console.error("ERROR: frost-signer binary not found. Run: cd crates/frost-signer && cargo build --release");
    Deno.exit(1);
  }

  // Ensure output directory
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  // === DKG Round 1 ===
  console.log("\n=== DKG Round 1 ===");
  const round1: Array<{ secretPackage: string; package: string; identifier: string }> = [];

  for (let i = 1; i <= TOTAL; i++) {
    const r = await dkgRound1(i, TOTAL, THRESHOLD);
    if (!r.ok) { console.error(`Round 1 failed for signer ${i}:`, r.error); Deno.exit(1); }
    const sp = JSON.stringify(r.data!.secret_package);
    const pkg = JSON.stringify(r.data!.package);
    const id = (r.data!.secret_package as Record<string, unknown>).identifier as string;
    round1.push({ secretPackage: sp, package: pkg, identifier: id });
    console.log(`  Signer ${i}: OK (id=${id.slice(0, 8)}...)`);
  }

  // === DKG Round 2 ===
  console.log("\n=== DKG Round 2 ===");
  const round2: Array<{ secretPackage: string; packages: Record<string, unknown> }> = [];

  for (let i = 0; i < TOTAL; i++) {
    const othersMap: Record<string, unknown> = {};
    for (let j = 0; j < TOTAL; j++) {
      if (j === i) continue;
      othersMap[round1[j]!.identifier] = JSON.parse(round1[j]!.package);
    }
    const r = await dkgRound2(round1[i]!.secretPackage, JSON.stringify(othersMap));
    if (!r.ok) { console.error(`Round 2 failed for signer ${i + 1}:`, r.error); Deno.exit(1); }
    round2.push({
      secretPackage: JSON.stringify(r.data!.secret_package),
      packages: r.data!.packages as Record<string, unknown>,
    });
    console.log(`  Signer ${i + 1}: OK`);
  }

  // === DKG Round 3 ===
  console.log("\n=== DKG Round 3 ===");
  const nodeConfigs: FrostNodeConfig[] = [];

  for (let i = 0; i < TOTAL; i++) {
    // Build round1 others map
    const othersR1: Record<string, unknown> = {};
    for (let j = 0; j < TOTAL; j++) {
      if (j === i) continue;
      othersR1[round1[j]!.identifier] = JSON.parse(round1[j]!.package);
    }

    // Build round2 packages addressed to signer i
    const r2ForMe: Record<string, unknown> = {};
    for (let j = 0; j < TOTAL; j++) {
      if (j === i) continue;
      const pkgsFromJ = round2[j]!.packages as Record<string, unknown>;
      r2ForMe[round1[j]!.identifier] = pkgsFromJ[round1[i]!.identifier];
    }

    const r = await dkgRound3(round2[i]!.secretPackage, JSON.stringify(othersR1), JSON.stringify(r2ForMe));
    if (!r.ok) { console.error(`Round 3 failed for signer ${i + 1}:`, r.error); Deno.exit(1); }

    // Build peer list
    const peers: PeerConfig[] = [];
    for (let j = 0; j < TOTAL; j++) {
      peers.push({
        signer_index: j + 1,
        endpoint: `http://localhost:${BASE_PORT + j}`,
        api_key: API_KEY,
      });
    }

    nodeConfigs.push({
      signer_index: i + 1,
      total_signers: TOTAL,
      threshold: THRESHOLD,
      key_package: r.data!.key_package,
      pubkey_package: r.data!.pubkey_package,
      group_pubkey: r.data!.group_pubkey as string,
      peers,
    });

    console.log(`  Signer ${i + 1}: OK (group_pubkey=${(r.data!.group_pubkey as string).slice(0, 16)}...)`);
  }

  // Verify all group pubkeys match
  const gps = nodeConfigs.map(c => c.group_pubkey);
  if (new Set(gps).size !== 1) {
    console.error("ERROR: Group pubkeys don't match!");
    Deno.exit(1);
  }

  // === Save config files (restrictive permissions — contains secret key shares) ===
  console.log("\n=== Saving configs ===");
  for (const config of nodeConfigs) {
    const path = join(OUTPUT_DIR, `signer-${config.signer_index}.json`);
    Deno.writeTextFileSync(path, JSON.stringify(config, null, 2));
    // Set 0600 — only owner can read/write. key_package contains FROST secret shares.
    try { Deno.chmodSync(path, 0o600); } catch { /* Windows or restricted fs */ }
    console.log(`  ${path} (mode 0600)`);
  }

  console.log(`\nDKG complete. Group pubkey: ${gps[0]}`);
  console.log(`\nTo start the cluster:`);
  console.log(`  deno run --allow-all scripts/frost-oracle-cluster.ts`);
}

main().catch((e) => { console.error(e); Deno.exit(1); });
