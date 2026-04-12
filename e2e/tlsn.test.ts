/**
 * E2E tests for TLSNotary verification flow.
 *
 * Prerequisites:
 *   - Docker Verifier Server: docker compose up tlsn-verifier -d
 *   - Rust binaries built: cd crates/tlsn-prover && cargo build
 *   - Anchr server running: deno task dev
 *
 * Run:
 *   deno test e2e/tlsn.test.ts --allow-all --no-check
 */

import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { spawn } from "../src/runtime/mod.ts";
import { buildWorkerApiApp } from "../src/infrastructure/worker-api";
import { createQueryService, createQueryStore } from "../src/application/query-service";
import type { QueryInput, QueryResult } from "../src/domain/types";
import { join } from "node:path";
import { existsSync } from "node:fs";

const VERIFIER_HOST = process.env.TLSN_VERIFIER_HOST ?? "localhost:7046";
const __dirname = import.meta.dirname ?? new URL(".", import.meta.url).pathname;
const PROVER_BIN = join(__dirname, "../crates/tlsn-prover/target/debug/tlsn-prove");
const VERIFIER_BIN = join(__dirname, "../crates/tlsn-verifier/target/release/tlsn-verifier");

// bitFlyer public API — ECDSA cert (fast MPC-TLS), no rate limit for reads
const TARGET_URL = "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY";
const TARGET_SERVER = "api.bitflyer.com";
const TARGET_BODY_MARKER = "BTC_JPY";

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

  test("generates and verifies a real TLSNotary presentation", { sanitizeOps: false, sanitizeResources: false }, async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    // Generate real presentation via MPC-TLS
    const presentationB64 = await generatePresentation(TARGET_URL);
    expect(presentationB64.length).toBeGreaterThan(100);

    // Verify with tlsn-verifier binary
    const result = await verifyPresentation("/tmp/e2e-tlsn.presentation.tlsn");
    expect(result.valid).toBe(true);
    expect(result.server_name).toBe(TARGET_SERVER);
    expect(typeof result.revealed_body).toBe("string");
    expect((result.revealed_body as string)).toContain(TARGET_BODY_MARKER);
  });

  test("full Anchr API flow: create query → submit presentation → verify", { sanitizeOps: false, sanitizeResources: false }, async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    // Generate presentation
    const presentationB64 = await generatePresentation(TARGET_URL);

    // Create query service
    const store = createQueryStore();
    const svc = createQueryService({ store });

    const input: QueryInput = {
      description: "E2E: Verify BTC/JPY price",
      verification_requirements: ["tlsn"],
      tlsn_requirements: {
        target_url: TARGET_URL,
        conditions: [{ type: "jsonpath", expression: "product_code", description: "Product code exists" }],
      },
    };

    const query = svc.createQuery(input, { ttlSeconds: 600, bounty: { amount_sats: 21 } });
    expect(query.status).toBe("pending");
    expect(query.tlsn_requirements?.target_url).toBe(TARGET_URL);

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
    expect(checks.some(c => c.includes("Product code exists"))).toBe(true);

    // Verify tlsn_verified data
    const verified = outcome.query?.verification?.tlsn_verified;
    expect(verified?.server_name).toBe(TARGET_SERVER);
    expect(verified?.revealed_body).toContain(TARGET_BODY_MARKER);
  });

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

  test("extension result with CLI-generated presentation verifies via HTTP API", { sanitizeOps: false, sanitizeResources: false }, async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    const testService = createQueryService({ hooks: {} });
    const app = buildWorkerApiApp({ queryService: testService });

    // Create query
    const createRes = await app.request("/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "E2E: extension result test",
        verification_requirements: ["tlsn"],
        tlsn_requirements: {
          target_url: TARGET_URL,
          conditions: [{ type: "jsonpath", expression: "product_code", description: "Product code exists" }],
        },
        ttl_seconds: 600,
      }),
    });
    expect(createRes.status).toBe(201);
    const { query_id } = await createRes.json() as { query_id: string };

    // Generate real presentation via CLI prover
    const presentationB64 = await generatePresentation(TARGET_URL);

    // Submit as extension result — exercises the extension path in verifier.ts
    const submitRes = await app.request(`/queries/${query_id}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker_pubkey: "e2e_tlsn_worker",
        tlsn_extension_result: { presentation: presentationB64 },
      }),
    });

    const submitData = await submitRes.json() as Record<string, unknown>;
    expect(submitData.ok).toBe(true);
    expect((submitData.verification as Record<string, unknown>)?.passed).toBe(true);

    // Verify that tlsn_verified data is populated
    const verified = (submitData.verification as Record<string, unknown>)?.tlsn_verified as Record<string, unknown>;
    expect(verified?.server_name).toBe(TARGET_SERVER);
    expect(verified?.revealed_body).toContain(TARGET_BODY_MARKER);
  });

  test("HTTP API accepts tlsn_presentation field", { sanitizeOps: false, sanitizeResources: false }, async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    const testService = createQueryService({ hooks: {} });
    const app = buildWorkerApiApp({ queryService: testService });

    // Create query
    const createRes = await app.request("/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "E2E: HTTP API test",
        verification_requirements: ["tlsn"],
        tlsn_requirements: {
          target_url: TARGET_URL,
          conditions: [{ type: "jsonpath", expression: "product_code", description: "BTC/JPY price" }],
        },
        ttl_seconds: 600,
      }),
    });
    expect(createRes.status).toBe(201);
    const { query_id } = await createRes.json() as { query_id: string };

    // Generate and submit real presentation
    const presentationB64 = await generatePresentation(TARGET_URL);

    const submitRes = await app.request(`/queries/${query_id}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker_pubkey: "e2e_tlsn_worker",
        tlsn_presentation: presentationB64,
      }),
    });

    const submitData = await submitRes.json() as Record<string, unknown>;
    expect(submitData.ok).toBe(true);
    expect((submitData.verification as Record<string, unknown>)?.passed).toBe(true);
  });
});
