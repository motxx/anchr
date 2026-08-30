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
import {
  createOracleRegistry,
  createQueryService,
  createQueryStore,
  type Oracle,
  type OracleAttestation,
  type Query,
  type QueryInput,
  type QueryResult,
} from "@anchr/sdk/testing";
import { ProofSchema } from "@anchr/sdk";
import { isTlsnVerifiedData, verifyProof } from "@anchr/sdk/proofs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import process from "node:process";

const VERIFIER_HOST = process.env.TLSN_VERIFIER_HOST ?? "localhost:7046";
const VERIFIER_WS_PORT = process.env.TLSN_VERIFIER_WS_PORT ?? "7047";
const VERIFIER_WS_URL = `ws://${
  VERIFIER_HOST.split(":")[0] ?? "localhost"
}:${VERIFIER_WS_PORT}`;
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
const LOCAL_PRESENTATION_PATH_1 = "/tmp/e2e-tlsn-local-1.presentation.tlsn";
const LOCAL_PRESENTATION_PATH_2 = "/tmp/e2e-tlsn-local-2.presentation.tlsn";
const WS_PRESENTATION_PATH = "/tmp/e2e-tlsn-ws.presentation.tlsn";
const MUTATED_PRESENTATION_PATH = "/tmp/e2e-tlsn-mutated.presentation.tlsn";
const PROVER_ATTEMPTS = 3;
const TLSN_E2E_ORACLE_ID = "tlsn-e2e-oracle";
const TEST_NOTARY_PUBLIC_KEY =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const TEST_NOTARY_PRIVATE_KEY =
  "0000000000000000000000000000000000000000000000000000000000000001";
const OTHER_NOTARY_PUBLIC_KEY =
  "0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

let filePresentationPromise: Promise<string> | undefined;

function createTlsnE2eOracle(): Oracle {
  return {
    info: { id: TLSN_E2E_ORACLE_ID, name: "TLSN e2e oracle", fee_ppm: 0 },
    async verify(
      query: Query,
      result: QueryResult,
    ): Promise<OracleAttestation> {
      const verification = await verifyProof(
        {
          id: query.id,
          schema: query.schema,
          factors: query.verification_requirements,
          description: query.description,
          challenge_nonce: query.challenge_nonce,
          schema_requirement: query.schema_requirement,
        },
        {
          attachments: result.attachments,
          schema_evidence: result.schema_evidence,
        },
        {
          schemaOptions: {
            [ProofSchema.TlsnV1]: {
              notaryPublicKey: TEST_NOTARY_PUBLIC_KEY,
            },
          },
        },
      );

      return {
        oracle_id: TLSN_E2E_ORACLE_ID,
        query_id: query.id,
        passed: verification.passed,
        checks: verification.checks,
        failures: verification.failures,
        attested_at: Date.now(),
        schema_verdict: verification.schema_verdict,
      };
    },
  };
}

function createTlsnE2eOracleRegistry() {
  const registry = createOracleRegistry();
  registry.register(createTlsnE2eOracle());
  return registry;
}

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

async function runLocalProverOnce(outputPath: string): Promise<void> {
  const proc = spawn([PROVER_BIN, TARGET_URL, "-o", outputPath], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ANCHR_TLSN_NOTARY_PRIVATE_KEY_HEX: TEST_NOTARY_PRIVATE_KEY },
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Local prover failed: ${stderr}`);
  }
}

async function runWsProverOnce(): Promise<void> {
  const proc = spawn([
    PROVER_BIN,
    "--verifier",
    VERIFIER_WS_URL,
    TARGET_URL,
    "-o",
    WS_PRESENTATION_PATH,
  ], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ANCHR_TLSN_NOTARY_PRIVATE_KEY_HEX: TEST_NOTARY_PRIVATE_KEY },
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`WebSocket prover failed: ${stderr}`);
  }
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
  notaryPublicKey = TEST_NOTARY_PUBLIC_KEY,
): Promise<Record<string, unknown>> {
  const proc = spawn([VERIFIER_BIN, "verify", path], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ANCHR_TLSN_NOTARY_PUBLIC_KEY_HEX: notaryPublicKey },
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

  test("two local prover runs use the same configured notary key", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    await runLocalProverOnce(LOCAL_PRESENTATION_PATH_1);
    await runLocalProverOnce(LOCAL_PRESENTATION_PATH_2);

    const first = await verifyPresentation(LOCAL_PRESENTATION_PATH_1);
    const second = await verifyPresentation(LOCAL_PRESENTATION_PATH_2);
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
  });

  test("WebSocket prover uses the configured notary key", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    await runWsProverOnce();
    const result = await verifyPresentation(WS_PRESENTATION_PATH);
    expect(result.valid).toBe(true);
  });

  test("INV-01: rejects a presentation signed by a non-pinned notary", async () => {
    if (!verifierReachable || !proverAvailable || !verifierBinAvailable) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    await getFilePresentation();
    const result = await verifyPresentation(
      PRESENTATION_PATH,
      OTHER_NOTARY_PUBLIC_KEY,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Notary key mismatch");
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
      oracleRegistry: createTlsnE2eOracleRegistry(),
    });

    const input: QueryInput = {
      description: "E2E: Verify BTC/JPY price",
      schema: ProofSchema.TlsnV1,
      verification_requirements: ["tlsn"],
      schema_requirement: {
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
      oracleIds: [TLSN_E2E_ORACLE_ID],
    });
    expect(query.status).toBe("pending");
    expect(query.schema_requirement).toEqual(input.schema_requirement);

    // Submit with real presentation
    const result: QueryResult = {
      attachments: [],
      schema_evidence: { presentation: presentationB64 },
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

    // Verify schema_verdict data
    const verified = outcome.query?.verification?.schema_verdict;
    expect(isTlsnVerifiedData(verified)).toBe(true);
    if (!isTlsnVerifiedData(verified)) return;
    expect(verified?.server_name).toBe(TARGET_SERVER);
    expect(verified?.revealed_body).toContain(TARGET_BODY_MARKER);
  });

  test("rejects submission without presentation", async () => {
    const store = createQueryStore();
    const svc = createQueryService({
      store,
      oracleRegistry: createTlsnE2eOracleRegistry(),
    });

    const query = svc.createQuery({
      description: "E2E: no attestation",
      schema: ProofSchema.TlsnV1,
      verification_requirements: ["tlsn"],
      schema_requirement: { target_url: "https://example.com" },
    }, { ttlSeconds: 120, oracleIds: [TLSN_E2E_ORACLE_ID] });

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
        oracleRegistry: createTlsnE2eOracleRegistry(),
      });
      const query = testService.createQuery(
        {
          description: "E2E: extension result test",
          schema: ProofSchema.TlsnV1,
          verification_requirements: ["tlsn"],
          schema_requirement: {
            target_url: TARGET_URL,
            conditions: [{
              type: "jsonpath",
              expression: "product_code",
              description: "Product code exists",
            }],
          },
        },
        { ttlSeconds: 600, oracleIds: [TLSN_E2E_ORACLE_ID] },
      );

      const presentationB64 = await generatePresentation(TARGET_URL);

      const submitOutcome = await testService.submitQueryResult(
        query.id,
        {
          attachments: [],
          schema_evidence: { presentation: presentationB64 },
        },
        { executor_type: "human", channel: "adapter" },
      );
      expect(submitOutcome.ok).toBe(true);
      expect(submitOutcome.query?.verification?.passed).toBe(true);

      // Verify that schema_verdict data is populated
      const verified = submitOutcome.query?.verification?.schema_verdict;
      expect(isTlsnVerifiedData(verified)).toBe(true);
      if (!isTlsnVerifiedData(verified)) return;
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
      oracleRegistry: createTlsnE2eOracleRegistry(),
    });
    const query = testService.createQuery(
      {
        description: "E2E: HTTP API test",
        schema: ProofSchema.TlsnV1,
        verification_requirements: ["tlsn"],
        schema_requirement: {
          target_url: TARGET_URL,
          conditions: [{
            type: "jsonpath",
            expression: "product_code",
            description: "BTC/JPY price",
          }],
        },
      },
      { ttlSeconds: 600, oracleIds: [TLSN_E2E_ORACLE_ID] },
    );

    const presentationB64 = await generatePresentation(TARGET_URL);

    const submitOutcome = await testService.submitQueryResult(
      query.id,
      {
        attachments: [],
        schema_evidence: { presentation: presentationB64 },
      },
      { executor_type: "human", channel: "adapter" },
    );
    expect(submitOutcome.ok).toBe(true);
    expect(submitOutcome.query?.verification?.passed).toBe(true);
  });
});
