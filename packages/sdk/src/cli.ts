#!/usr/bin/env bun
/**
 * Anchr Auto-Worker CLI
 *
 * Usage:
 *   bun run packages/sdk/src/cli.ts --server http://localhost:3000 --verifier localhost:7047
 *   bunx anchr-worker --server http://localhost:3000 --verifier localhost:7047
 */

import { AnchrWorker } from "./worker.ts";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv?.slice(2) ?? [];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    if (key.startsWith("--") && i + 1 < argv.length) {
      args[key.slice(2)] = argv[i + 1]!;
      i++;
    }
  }
  return args;
}

const args = parseArgs();

const worker = new AnchrWorker({
  serverUrl: args.server ?? Deno.env.get("ANCHR_SERVER_URL") ?? "http://localhost:3000",
  verifierHost: args.verifier ?? Deno.env.get("TLSN_VERIFIER_HOST") ?? "localhost:7047",
  proverBin: args.prover ?? Deno.env.get("TLSN_PROVER_BIN"),
  apiKey: args["api-key"] ?? Deno.env.get("HTTP_API_KEY"),
  pollIntervalMs: Number(args["poll-interval"] ?? 5000),
  maxConcurrent: Number(args["max-concurrent"] ?? 1),
  minBountySats: Number(args["min-bounty"] ?? 0),
});

worker.on("fulfilled", (event) => {
  console.log(JSON.stringify({
    type: "fulfilled",
    queryId: event.queryId,
    ok: event.ok,
    targetUrl: event.targetUrl,
    durationMs: event.durationMs,
  }));
});

worker.on("error", (queryId, error) => {
  console.error(JSON.stringify({
    type: "error",
    queryId,
    error: error.message,
  }));
});

console.error("[anchr-worker] Starting...");
worker.start();
