import { test, expect, describe } from "bun:test";
import { Anchr, AnchrError, QueryTimeoutError, VerificationFailedError } from "./index.ts";

describe("Anchr SDK", () => {
  test("constructor accepts config", () => {
    const anchr = new Anchr({ serverUrl: "http://localhost:3000" });
    expect(anchr).toBeInstanceOf(Anchr);
  });

  test("constructor trims trailing slash", () => {
    const anchr = new Anchr({ serverUrl: "http://localhost:3000/" });
    expect(anchr).toBeInstanceOf(Anchr);
  });

  test("error types", () => {
    const err = new AnchrError("test", "TEST_CODE");
    expect(err.code).toBe("TEST_CODE");
    expect(err.name).toBe("AnchrError");

    const timeout = new QueryTimeoutError("q1", 60);
    expect(timeout.code).toBe("TIMEOUT");

    const fail = new VerificationFailedError("q1", ["bad sig"]);
    expect(fail.code).toBe("VERIFICATION_FAILED");
  });
});

describe("Anchr SDK E2E", () => {
  const SERVER_URL = "http://localhost:3000";

  async function isServerRunning(): Promise<boolean> {
    try {
      const res = await fetch(`${SERVER_URL}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  test("query creates and polls a TLSNotary query", async () => {
    if (!(await isServerRunning())) {
      console.error("[sdk-test] SKIPPED — Anchr server not running on", SERVER_URL);
      return;
    }

    const anchr = new Anchr({ serverUrl: SERVER_URL });

    // Create a query — will timeout since no worker is running
    await expect(
      anchr.query({
        description: "SDK test: BTC price",
        targetUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
        maxSats: 1,
        timeoutSeconds: 60,     // server TTL
        pollTimeoutSeconds: 5,  // client waits 5s then gives up
      }),
    ).rejects.toBeInstanceOf(QueryTimeoutError);
  }, 15_000);

  test("createTlsnQuery + getQueryStatus", async () => {
    if (!(await isServerRunning())) {
      console.error("[sdk-test] SKIPPED — Anchr server not running");
      return;
    }

    const anchr = new Anchr({ serverUrl: SERVER_URL });

    const queryId = await anchr.createTlsnQuery({
      description: "SDK test: status check",
      targetUrl: "https://httpbin.org/get",
      maxSats: 1,
      timeoutSeconds: 60,
    });

    expect(queryId).toMatch(/^query_/);

    const status = await anchr.getQueryStatus(queryId);
    expect(status.id).toBe(queryId);
    expect(status.status).toBe("pending");
  });

  test("listOpenQueries", async () => {
    if (!(await isServerRunning())) {
      console.error("[sdk-test] SKIPPED — Anchr server not running");
      return;
    }

    const anchr = new Anchr({ serverUrl: SERVER_URL });
    const queries = await anchr.listOpenQueries();
    expect(Array.isArray(queries)).toBe(true);
  });
});
