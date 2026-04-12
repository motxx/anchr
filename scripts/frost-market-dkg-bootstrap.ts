#!/usr/bin/env -S deno run --allow-all
/**
 * FROST Market DKG Bootstrap -- generates key material for a prediction market
 * Oracle cluster with TWO threshold groups (YES and NO outcomes).
 *
 * Usage:
 *   deno run --allow-all scripts/frost-market-dkg-bootstrap.ts \
 *     --threshold 2 --total 3 --output-dir .frost-market --base-port 4001
 *
 * Produces:
 *   .frost-market/signer-1.json  # Contains YES + NO group keys
 *   .frost-market/signer-2.json
 *   .frost-market/signer-3.json
 *
 * Each file is a MarketFrostNodeConfig with keys for both outcome groups.
 * The two groups have INDEPENDENT DKG sessions -- different group pubkeys,
 * different key shares -- so signing with one group reveals nothing about
 * the other.
 */

import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  dkgRound1,
  dkgRound2,
  dkgRound3,
  isFrostSignerAvailable,
} from "../src/infrastructure/frost/frost-cli.ts";
import type { PeerConfig } from "../src/infrastructure/frost/config.ts";
import type { MarketFrostNodeConfig } from "../src/infrastructure/frost/market-frost-config.ts";

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
const OUTPUT_DIR = args.outputDir ?? ".frost-market";
const BASE_PORT = args.basePort ?? 4001;
const API_KEY = args.apiKey ?? "frost-market-key";

// --- DKG runner for a single group ---

interface DkgGroupResult {
  configs: Array<{
    key_package: unknown;
    pubkey_package: unknown;
    group_pubkey: string;
  }>;
  group_pubkey: string;
}

async function runDkg(groupLabel: string): Promise<DkgGroupResult> {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`DKG for ${groupLabel} group`);
  console.log(`${"=".repeat(50)}`);

  // === Round 1 ===
  console.log(`\n--- ${groupLabel} Round 1 ---`);
  const round1: Array<{ secretPackage: string; package: string; identifier: string }> = [];

  for (let i = 1; i <= TOTAL; i++) {
    const r = await dkgRound1(i, TOTAL, THRESHOLD);
    if (!r.ok) {
      console.error(`Round 1 failed for signer ${i}:`, r.error);
      Deno.exit(1);
    }
    const sp = JSON.stringify(r.data!.secret_package);
    const pkg = JSON.stringify(r.data!.package);
    const id = (r.data!.secret_package as Record<string, unknown>).identifier as string;
    round1.push({ secretPackage: sp, package: pkg, identifier: id });
    console.log(`  Signer ${i}: OK (id=${id.slice(0, 8)}...)`);
  }

  // === Round 2 ===
  console.log(`\n--- ${groupLabel} Round 2 ---`);
  const round2: Array<{ secretPackage: string; packages: Record<string, unknown> }> = [];

  for (let i = 0; i < TOTAL; i++) {
    const othersMap: Record<string, unknown> = {};
    for (let j = 0; j < TOTAL; j++) {
      if (j === i) continue;
      othersMap[round1[j]!.identifier] = JSON.parse(round1[j]!.package);
    }
    const r = await dkgRound2(round1[i]!.secretPackage, JSON.stringify(othersMap));
    if (!r.ok) {
      console.error(`Round 2 failed for signer ${i + 1}:`, r.error);
      Deno.exit(1);
    }
    round2.push({
      secretPackage: JSON.stringify(r.data!.secret_package),
      packages: r.data!.packages as Record<string, unknown>,
    });
    console.log(`  Signer ${i + 1}: OK`);
  }

  // === Round 3 ===
  console.log(`\n--- ${groupLabel} Round 3 ---`);
  const configs: DkgGroupResult["configs"] = [];

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
    if (!r.ok) {
      console.error(`Round 3 failed for signer ${i + 1}:`, r.error);
      Deno.exit(1);
    }

    configs.push({
      key_package: r.data!.key_package,
      pubkey_package: r.data!.pubkey_package,
      group_pubkey: r.data!.group_pubkey as string,
    });

    console.log(`  Signer ${i + 1}: OK (group_pubkey=${(r.data!.group_pubkey as string).slice(0, 16)}...)`);
  }

  // Verify all group pubkeys match
  const gps = configs.map(c => c.group_pubkey);
  if (new Set(gps).size !== 1) {
    console.error(`ERROR: ${groupLabel} group pubkeys don't match!`);
    Deno.exit(1);
  }

  console.log(`  ${groupLabel} group pubkey: ${gps[0]}`);

  return {
    configs,
    group_pubkey: gps[0]!,
  };
}

// --- Main ---

async function main() {
  console.log(`FROST Market DKG Bootstrap: ${THRESHOLD}-of-${TOTAL}`);
  console.log(`Output: ${OUTPUT_DIR}/signer-{1..${TOTAL}}.json`);
  console.log(`Two independent DKG sessions (YES + NO outcome groups)`);

  if (!isFrostSignerAvailable()) {
    console.error("ERROR: frost-signer binary not found.");
    console.error("Run: cd crates/frost-signer && cargo build --release");
    Deno.exit(1);
  }

  // Ensure output directory
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  // Run DKG for both groups
  const yesGroup = await runDkg("YES");
  const noGroup = await runDkg("NO");

  // Verify the two groups have different pubkeys (independent DKG sessions)
  if (yesGroup.group_pubkey === noGroup.group_pubkey) {
    console.error("ERROR: YES and NO groups have the same pubkey -- DKG may be broken");
    Deno.exit(1);
  }

  // === Combine into MarketFrostNodeConfig per signer ===
  console.log("\n=== Saving combined configs ===");

  for (let i = 0; i < TOTAL; i++) {
    const yesConfig = yesGroup.configs[i]!;
    const noConfig = noGroup.configs[i]!;

    // Build peer list
    const peers: PeerConfig[] = [];
    for (let j = 0; j < TOTAL; j++) {
      peers.push({
        signer_index: j + 1,
        endpoint: `http://localhost:${BASE_PORT + j}`,
        api_key: API_KEY,
      });
    }

    const marketConfig: MarketFrostNodeConfig = {
      // Common
      signer_index: i + 1,
      total_signers: TOTAL,
      threshold: THRESHOLD,
      peers,

      // YES group (standard FrostNodeConfig fields)
      key_package: yesConfig.key_package,
      pubkey_package: yesConfig.pubkey_package,
      group_pubkey: yesConfig.group_pubkey,

      // NO group (additional fields)
      key_package_no: noConfig.key_package,
      pubkey_package_no: noConfig.pubkey_package,
      group_pubkey_no: noConfig.group_pubkey,
    };

    const path = join(OUTPUT_DIR, `signer-${i + 1}.json`);
    Deno.writeTextFileSync(path, JSON.stringify(marketConfig, null, 2));
    // Set 0600 -- only owner can read/write. Contains FROST secret key shares.
    try { Deno.chmodSync(path, 0o600); } catch { /* Windows or restricted fs */ }
    console.log(`  ${path} (mode 0600)`);
  }

  console.log(`\nDKG complete.`);
  console.log(`  YES group pubkey: ${yesGroup.group_pubkey}`);
  console.log(`  NO  group pubkey: ${noGroup.group_pubkey}`);
  console.log(`\nTo start the market Oracle cluster:`);
  console.log(`  deno run --allow-all scripts/frost-market-oracle-cluster.ts`);
}

main().catch((e) => { console.error(e); Deno.exit(1); });
