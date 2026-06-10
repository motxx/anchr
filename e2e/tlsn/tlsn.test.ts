/**
 * E2E tests for TLSNotary verification flow.
 *
 * Prerequisites:
 *   - Docker Verifier Server: docker compose up tlsn-verifier -d
 *   - Rust binaries built: cd crates/tlsn-prover && cargo build
 * Run:
 *   deno task test:e2e:tlsn
 */

import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { spawn } from "../helpers/process.ts";
import { createQueryService, createQueryStore } from "@anchr/sdk/testing";
import { createOracleRegistry } from "@anchr/sdk/adapters/oracle-client";
import type { QueryInput, QueryResult } from "@anchr/sdk/testing";
import { join } from "node:path";
import { existsSync } from "node:fs";
import process from "node:process";

const VERIFIER_HOST = process.env.TLSN_VERIFIER_HOST ?? "localhost:7046";
const REQUIRE_CORE_INFRA = process.env.TLSN_E2E_REQUIRE_CORE === "1";
const __dirname = import.meta.dirname ?? new URL(".", import.meta.url).pathname;
const PROVER_BIN = join(
  __dirname,
  "../../crates/tlsn-prover/target/debug/tlsn-prove",
);
const VERIFIER_BIN = join(
  __dirname,
  "../../crates/tlsn-verifier/target/release/tlsn-verifier",
);

// bitFlyer public API — ECDSA cert (fast MPC-TLS), no rate limit for reads
const TARGET_URL = "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY";
const TARGET_SERVER = "api.bitflyer.com";
const TARGET_BODY_MARKER = "BTC_JPY";
const PRESENTATION_PATH = "/tmp/e2e-tlsn.presentation.tlsn";
const MUTATED_PRESENTATION_PATH = "/tmp/e2e-tlsn-mutated.presentation.tlsn";
const PROVER_ATTEMPTS = 3;

let filePresentationPromise: Promise<string> | undefined;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableProverFailure(stderr: string): boolean {
  return [
    "failed to lookup address information",
    "temporary failure in name resolution",
    "could not resolve",
    "network is unreachable",
    "connection reset",
    "connection refused",
    "timed out",
  ].some((marker) => stderr.toLowerCase().includes(marker));
}

async function runProverOnce(targetUrl: string): Promise<string> {
  const proc = spawn([
    PROVER_BIN,
    "--verifier",
    VERIFIER_HOST,
    targetUrl,
    "-o",
    PRESENTATION_PATH,
  ], {
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

async function generatePresentation(targetUrl: string): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= PROVER_ATTEMPTS; attempt++) {
    try {
      return await runProverOnce(targetUrl);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (
        attempt === PROVER_ATTEMPTS ||
        !isRetryableProverFailure(lastError.message)
      ) {
        throw lastError;
      }
      await delay(500 * attempt);
    }
  }

  throw lastError ?? new Error("Prover failed without an error");
}

function getFilePresentation(): Promise<string> {
  filePresentationPromise ??= generatePresentation(TARGET_URL);
  return filePresentationPromise;
}

async function verifyPresentation(
  path: string,
): Promise<Record<string, unknown>> {
  const proc = spawn([VERIFIER_BIN, "verify", path], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return JSON.parse(stdout);
}

async function mutatePresentation(src: string, dst: string): Promise<void> {
  const bytes = await Deno.readFile(src);
  expect(bytes.length).toBeGreaterThan(32);
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  await Deno.writeFile(dst, bytes);
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
      console.error(
        "[e2e] TLSNotary Verifier Server not reachable at",
        VERIFIER_HOST,
      );
      console.error("[e2e] Run: docker compose up tlsn-verifier -d");
    }
    if (!proverAvailable) {
      console.error("[e2e] tlsn-prove binary not found at", PROVER_BIN);
      console.error("[e2e] Run: cd crates/tlsn-prover && cargo build");
    }
    if (!verifierBinAvailable) {
      console.error("[e2e] tlsn-verifier binary not found at", VERIFIER_BIN);
      console.error(
        "[e2e] Run: cd crates/tlsn-verifier && cargo build --release",
      );
    }

    if (
      REQUIRE_CORE_INFRA &&
      (!verifierReachable || !proverAvailable || !verifierBinAvailable)
    ) {
      throw new Error(
        "TLSNotary core e2e infrastructure is required but not ready",
      );
    }
  });

  test("generates and verifies a real TLSNotary presentation", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    const presentationB64 = await getFilePresentation();
    expect(presentationB64.length).toBeGreaterThan(100);

    // Verify with tlsn-verifier binary
    const result = await verifyPresentation(PRESENTATION_PATH);
    expect(result.valid).toBe(true);
    expect(result.server_name).toBe(TARGET_SERVER);
    expect(typeof result.revealed_body).toBe("string");
    expect(result.revealed_body as string).toContain(TARGET_BODY_MARKER);
  });

  // INV-01
  test("INV-01: rejects a mutated TLSNotary presentation", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    await getFilePresentation();
    await mutatePresentation(
      PRESENTATION_PATH,
      MUTATED_PRESENTATION_PATH,
    );

    const result = await verifyPresentation(
      MUTATED_PRESENTATION_PATH,
    );
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  test("full Anchr API flow: create query → submit presentation → verify", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    const presentationB64 = await generatePresentation(TARGET_URL);

    // Create query service
    const store = createQueryStore();
    const svc = createQueryService({
      store,
      oracleRegistry: createOracleRegistry(),
    });

    const input: QueryInput = {
      description: "E2E: Verify BTC/JPY price",
      verification_requirements: ["tlsn"],
      visibility: "customer_only",
      tlsn_requirements: {
        target_url: TARGET_URL,
        conditions: [{
          type: "jsonpath",
          expression: "product_code",
          description: "Product code exists",
        }],
      },
    };

    const query = svc.createQuery(input, {
      ttlSeconds: 600,
      payment_lock: { amount_sats: 21 },
    });
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
      { executor_type: "human", channel: "adapter" },
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("Verification passed");
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.verification?.passed).toBe(true);

    // Verify checks
    const checks = outcome.query?.verification?.checks ?? [];
    expect(checks.some((c) => c.includes("cryptographically verified"))).toBe(
      true,
    );
    expect(checks.some((c) => c.includes("server name matches"))).toBe(true);
    expect(checks.some((c) => c.includes("Product code exists"))).toBe(true);

    // Verify tlsn_verified data
    const verified = outcome.query?.verification?.tlsn_verified;
    expect(verified?.server_name).toBe(TARGET_SERVER);
    expect(verified?.revealed_body).toContain(TARGET_BODY_MARKER);
  });

  test("rejects submission without presentation", async () => {
    const store = createQueryStore();
    const svc = createQueryService({
      store,
      oracleRegistry: createOracleRegistry(),
    });

    const query = svc.createQuery({
      description: "E2E: no attestation",
      verification_requirements: ["tlsn"],
      tlsn_requirements: { target_url: "https://example.com" },
      visibility: "customer_only",
    }, { ttlSeconds: 120 });

    const outcome = await svc.submitQueryResult(
      query.id,
      { attachments: [] },
      { executor_type: "human", channel: "adapter" },
    );

    expect(outcome.ok).toBe(false);
    expect(
      outcome.query?.verification?.failures.some((f) =>
        f.includes("no attestation")
      ),
    ).toBe(true);
  });

  test(
    "extension result with CLI-generated presentation verifies via HTTP API",
    async () => {
      if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
        console.error("[e2e] SKIPPED — infrastructure not ready");
        return;
      }

      const testService = createQueryService({
        hooks: {},
        oracleRegistry: createOracleRegistry(),
      });
      const query = testService.createQuery(
        {
          description: "E2E: extension result test",
          verification_requirements: ["tlsn"],
          visibility: "customer_only",
          tlsn_requirements: {
            target_url: TARGET_URL,
            conditions: [{
              type: "jsonpath",
              expression: "product_code",
              description: "Product code exists",
            }],
          },
        },
        { ttlSeconds: 600 },
      );

      const presentationB64 = await generatePresentation(TARGET_URL);

      const submitOutcome = await testService.submitQueryResult(
        query.id,
        {
          attachments: [],
          tlsn_extension_result: { presentation: presentationB64 },
        },
        { executor_type: "human", channel: "adapter" },
      );
      expect(submitOutcome.ok).toBe(true);
      expect(submitOutcome.query?.verification?.passed).toBe(true);

      // Verify that tlsn_verified data is populated
      const verified = submitOutcome.query?.verification?.tlsn_verified;
      expect(verified?.server_name).toBe(TARGET_SERVER);
      expect(verified?.revealed_body).toContain(TARGET_BODY_MARKER);
    },
  );

  test("service accepts TLSNotary presentation result", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    const testService = createQueryService({
      hooks: {},
      oracleRegistry: createOracleRegistry(),
    });
    const query = testService.createQuery(
      {
        description: "E2E: HTTP API test",
        verification_requirements: ["tlsn"],
        visibility: "customer_only",
        tlsn_requirements: {
          target_url: TARGET_URL,
          conditions: [{
            type: "jsonpath",
            expression: "product_code",
            description: "BTC/JPY price",
          }],
        },
      },
      { ttlSeconds: 600 },
    );

    const presentationB64 = await generatePresentation(TARGET_URL);

    const submitOutcome = await testService.submitQueryResult(
      query.id,
      {
        attachments: [],
        tlsn_attestation: { presentation: presentationB64 },
      },
      { executor_type: "human", channel: "adapter" },
    );
    expect(submitOutcome.ok).toBe(true);
    expect(submitOutcome.query?.verification?.passed).toBe(true);
  });
});
