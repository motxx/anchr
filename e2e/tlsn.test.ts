/**
 * E2E tests for TLSNotary verification flow.
 *
 * Prerequisites:
 *   - Docker Verifier Server: docker compose up tlsn-verifier -d
 *   - Rust binaries built: cd crates/tlsn-prover && cargo build
 *   - Anchr server running: bun run src/index.ts
 *
 * Run:
 *   bun test e2e/tlsn.test.ts
 */

import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { spawn } from "../src/runtime/mod.ts";
import { buildWorkerApiApp } from "../src/worker-api";
import { createQueryService, createQueryStore } from "../src/query-service";
import type { QueryInput, QueryResult } from "../src/types";
import { join } from "node:path";
import { existsSync } from "node:fs";

const VERIFIER_HOST = process.env.TLSN_VERIFIER_HOST ?? "localhost:7046";
const PROVER_BIN = join(import.meta.dir, "../crates/tlsn-prover/target/debug/tlsn-prove");
const VERIFIER_BIN = join(import.meta.dir, "../crates/tlsn-verifier/target/release/tlsn-verifier");

async function isVerifierReachable(): Promise<boolean> {
  try {
    const conn = await Deno.connect({
      hostname: VERIFIER_HOST.split(":")[0]!,
      port: parseInt(VERIFIER_HOST.split(":")[1] ?? "7047", 10),
    });
    conn.close();
    return true;
  } catch {
    return false;
  }
}

function hasProverBin(): boolean {
  return existsSync(PROVER_BIN);
}

function hasVerifierBin(): boolean {
  return existsSync(VERIFIER_BIN);
}

async function generatePresentation(targetUrl: string): Promise<string> {
  const proc = spawn([PROVER_BIN, "--verifier", VERIFIER_HOST, targetUrl, "-o", "/tmp/e2e-tlsn.presentation.tlsn"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Prover failed: ${stderr}`);
  }
  // stdout contains base64
  const stdout = await new Response(proc.stdout).text();
  return stdout.trim();
}

async function verifyPresentation(path: string): Promise<Record<string, unknown>> {
  const proc = spawn([VERIFIER_BIN, "verify", path], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return JSON.parse(stdout);
}

describe("TLSNotary E2E", () => {
  let verifierReachable = false;
  let proverAvailable = false;
  let verifierBinAvailable = false;

  beforeAll(async () => {
    verifierReachable = await isVerifierReachable();
    proverAvailable = hasProverBin();
    verifierBinAvailable = hasVerifierBin();

    if (!verifierReachable) {
      console.error("[e2e] TLSNotary Verifier Server not reachable at", VERIFIER_HOST);
      console.error("[e2e] Run: docker compose up tlsn-verifier -d");
    }
    if (!proverAvailable) {
      console.error("[e2e] tlsn-prove binary not found at", PROVER_BIN);
      console.error("[e2e] Run: cd crates/tlsn-prover && cargo build");
    }
    if (!verifierBinAvailable) {
      console.error("[e2e] tlsn-verifier binary not found at", VERIFIER_BIN);
      console.error("[e2e] Run: cd crates/tlsn-verifier && cargo build --release");
    }
  });

  test("generates and verifies a real TLSNotary presentation", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    // Generate real presentation via MPC-TLS
    const targetUrl = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
    const presentationB64 = await generatePresentation(targetUrl);
    expect(presentationB64.length).toBeGreaterThan(100);

    // Verify with tlsn-verifier binary
    const result = await verifyPresentation("/tmp/e2e-tlsn.presentation.tlsn");
    expect(result.valid).toBe(true);
    expect(result.server_name).toBe("api.coingecko.com");
    expect(typeof result.revealed_body).toBe("string");
    expect((result.revealed_body as string)).toContain("bitcoin");
  }, 60_000);

  test("full Anchr API flow: create query → submit presentation → verify", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    // Generate presentation
    const targetUrl = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
    const presentationB64 = await generatePresentation(targetUrl);

    // Create query service
    const store = createQueryStore();
    const svc = createQueryService({ store });

    const input: QueryInput = {
      description: "E2E: Verify BTC price",
      verification_requirements: ["tlsn"],
      tlsn_requirements: {
        target_url: targetUrl,
        conditions: [{ type: "jsonpath", expression: "bitcoin.usd", description: "BTC price exists" }],
      },
    };

    const query = svc.createQuery(input, { ttlSeconds: 600, bounty: { amount_sats: 21 } });
    expect(query.status).toBe("pending");
    expect(query.tlsn_requirements?.target_url).toBe(targetUrl);

    // Submit with real presentation
    const result: QueryResult = {
      attachments: [],
      tlsn_attestation: { presentation: presentationB64 },
    };

    const outcome = await svc.submitQueryResult(
      query.id,
      result,
      { executor_type: "human", channel: "worker_api" },
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("Verification passed");
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.verification?.passed).toBe(true);

    // Verify checks
    const checks = outcome.query?.verification?.checks ?? [];
    expect(checks.some(c => c.includes("cryptographically verified"))).toBe(true);
    expect(checks.some(c => c.includes("server name matches"))).toBe(true);
    expect(checks.some(c => c.includes("BTC price exists"))).toBe(true);

    // Verify tlsn_verified data
    const verified = outcome.query?.verification?.tlsn_verified;
    expect(verified?.server_name).toBe("api.coingecko.com");
    expect(verified?.revealed_body).toContain("bitcoin");
  }, 120_000);

  test("rejects submission without presentation", async () => {
    const store = createQueryStore();
    const svc = createQueryService({ store });

    const query = svc.createQuery({
      description: "E2E: no attestation",
      verification_requirements: ["tlsn"],
      tlsn_requirements: { target_url: "https://example.com" },
    }, { ttlSeconds: 120 });

    const outcome = await svc.submitQueryResult(
      query.id,
      { attachments: [] },
      { executor_type: "human", channel: "worker_api" },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.query?.verification?.failures.some(f => f.includes("no attestation"))).toBe(true);
  });

  test("extension result with CLI-generated presentation verifies via HTTP API", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    const app = buildWorkerApiApp();
    const targetUrl = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

    // Create query
    const createRes = await app.request("/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "E2E: extension result test",
        verification_requirements: ["tlsn"],
        tlsn_requirements: {
          target_url: targetUrl,
          conditions: [{ type: "jsonpath", expression: "bitcoin.usd", description: "BTC price exists" }],
        },
        ttl_seconds: 600,
      }),
    });
    expect(createRes.status).toBe(201);
    const { query_id } = await createRes.json() as { query_id: string };

    // Generate real presentation via CLI prover
    const presentationB64 = await generatePresentation(targetUrl);

    // Submit as extension result (not CLI attestation) — exercises the extension path in verifier.ts
    const submitRes = await app.request(`/queries/${query_id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tlsn_extension_result: { presentation: presentationB64 },
      }),
    });

    const submitData = await submitRes.json() as Record<string, unknown>;
    expect(submitData.ok).toBe(true);
    expect((submitData.verification as any)?.passed).toBe(true);

    // Verify that tlsn_verified data is populated
    const verified = (submitData.verification as any)?.tlsn_verified;
    expect(verified?.server_name).toBe("api.coingecko.com");
    expect(verified?.revealed_body).toContain("bitcoin");
  }, 120_000);

  test("HTTP API accepts tlsn_presentation field", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    const app = buildWorkerApiApp();

    // Create query
    const createRes = await app.request("/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "E2E: HTTP API test",
        verification_requirements: ["tlsn"],
        tlsn_requirements: {
          target_url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
          conditions: [{ type: "jsonpath", expression: "bitcoin.usd", description: "BTC price" }],
        },
        ttl_seconds: 600,
      }),
    });
    expect(createRes.status).toBe(201);
    const { query_id } = await createRes.json() as { query_id: string };

    // Generate and submit real presentation
    const presentationB64 = await generatePresentation(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    );

    const submitRes = await app.request(`/queries/${query_id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tlsn_presentation: presentationB64 }),
    });

    const submitData = await submitRes.json() as Record<string, unknown>;
    expect(submitData.ok).toBe(true);
    expect((submitData.verification as any)?.passed).toBe(true);
  }, 120_000);
});
