import { test, expect, describe, beforeAll } from "bun:test";
import { Anchr, QueryTimeoutError } from "./index";
import { AnchrWorker } from "./worker";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_URL = "http://localhost:3000";
const VERIFIER_HOST = "localhost:7046";
const PROVER_BIN = join(__dirname, "../../../crates/tlsn-prover/target/debug/tlsn-prove");

function checkTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = createConnection({ host, port }, () => {
      conn.end();
      resolve(true);
    });
    conn.on("error", () => resolve(false));
    conn.setTimeout(2000, () => { conn.destroy(); resolve(false); });
  });
}

async function isReady(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    if (!res.ok) return false;
    const tcpOk = await checkTcp("localhost", 7046);
    if (!tcpOk) return false;
    return existsSync(PROVER_BIN);
  } catch { return false; }
}

describe("AnchrWorker", () => {
  let ready = false;

  beforeAll(async () => {
    ready = await isReady();
    if (!ready) {
      console.error("[worker-test] SKIPPED — need Anchr server + Verifier Server + tlsn-prove");
    }
  });

  test("runOnce fulfills a TLSNotary query end-to-end", async () => {
    if (!ready) return;

    const anchr = new Anchr({ serverUrl: SERVER_URL });

    // Create a query
    const queryId = await anchr.createTlsnQuery({
      description: "Worker E2E: httpbin.org",
      targetUrl: "https://httpbin.org/get",
      maxSats: 1,
      timeoutSeconds: 120,
    });

    // Run worker once
    const worker = new AnchrWorker({
      serverUrl: SERVER_URL,
      verifierHost: VERIFIER_HOST,
      proverBin: PROVER_BIN,
    });

    const event = await worker.runOnce();
    expect(event).not.toBeNull();
    expect(event!.ok).toBe(true);
    expect(event!.queryId).toBe(queryId);
    expect(event!.targetUrl).toContain("httpbin.org");
    expect(event!.durationMs).toBeGreaterThan(0);

    // Verify query is approved
    const status = await anchr.getQueryStatus(queryId);
    expect(status.status).toBe("approved");
    expect(status.verification?.passed).toBe(true);
  }, 120_000);

  test("SDK query() + Worker auto-fulfill (full loop)", async () => {
    if (!ready) return;

    // Start worker in background
    const worker = new AnchrWorker({
      serverUrl: SERVER_URL,
      verifierHost: VERIFIER_HOST,
      proverBin: PROVER_BIN,
      pollIntervalMs: 2000,
    });

    const workerPromise = worker.start();

    // SDK query — should be auto-fulfilled by the worker
    const anchr = new Anchr({ serverUrl: SERVER_URL, pollIntervalMs: 2000 });

    try {
      const result = await anchr.query({
        description: "Full loop test: httpbin.org",
        targetUrl: "https://httpbin.org/get",
        conditions: [{ type: "contains", expression: "httpbin.org" }],
        maxSats: 1,
        timeoutSeconds: 120,
        pollTimeoutSeconds: 90,
      });

      expect(result.verified).toBe(true);
      expect(result.serverName).toBe("httpbin.org");
      expect(result.rawBody).toContain("httpbin.org");
      expect(typeof result.data).toBe("object");
    } finally {
      worker.stop();
    }
  }, 120_000);
});
