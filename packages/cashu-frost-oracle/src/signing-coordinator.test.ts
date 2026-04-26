/**
 * Unit tests for FROST signing coordinator.
 *
 * Mocks frost-cli functions (signRound1, signRound2, aggregateSignatures) and
 * peer HTTP endpoints using Hono test apps so no Rust binary is needed.
 */

import { describe, test, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import { coordinateSigning, type SigningCoordinatorConfig } from "./signing-coordinator.ts";
import type { FrostNodeConfig } from "./config.ts";

// ---------------------------------------------------------------------------
// Fake frost-cli data
// ---------------------------------------------------------------------------

const FAKE_COMMITMENTS_LOCAL = { hiding: "aaa111", binding: "bbb222" };
const FAKE_NONCES_LOCAL = { hiding_nonce: "nonce_hiding", binding_nonce: "nonce_binding" };
const FAKE_COMMITMENTS_PEER2 = { hiding: "ccc333", binding: "ddd444" };
const FAKE_COMMITMENTS_PEER3 = { hiding: "eee555", binding: "fff666" };
const FAKE_SHARE_LOCAL = "share_local_01";
const FAKE_SHARE_PEER2 = "share_peer_02";
const FAKE_SHARE_PEER3 = "share_peer_03";
const FAKE_SIGNATURE = "ab".repeat(32);

// ---------------------------------------------------------------------------
// Module-level mock for frost-cli via dynamic import override
//
// coordinateSigning imports signRound1, signRound2, aggregateSignatures
// directly at module level. We intercept by replacing the module's bindings.
// ---------------------------------------------------------------------------

// We cannot easily monkey-patch ES module bindings, so instead we mock at the
// frost-cli layer: set the binary path to a script that returns our fake data.
// But that requires a real script. Simpler: replace global fetch and mock the
// frost-cli functions by re-exporting from a test shim.
//
// The cleanest approach: the coordinator imports frost-cli statically, so we
// create a thin wrapper that intercepts the calls. Since the coordinator uses
// `import { signRound1, signRound2, aggregateSignatures } from "./frost-cli.ts"`,
// we can replace the underlying runFrostCommand by setting the binary path to
// a custom script.

import { _setFrostSignerPathForTest } from "./frost-cli.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mock frost-signer binary — a shell script that returns fake JSON based
// on the subcommand.
// ---------------------------------------------------------------------------

let mockDir: string;
let mockBinaryPath: string;

function setupMockBinary() {
  mockDir = mkdtempSync(join(tmpdir(), "anchr-frost-coord-test-"));
  mockBinaryPath = join(mockDir, "frost-signer");

  // Shell script that returns canned responses for sign-round1, sign-round2, aggregate
  const script = `#!/bin/sh
case "$1" in
  sign-round1)
    echo '{"nonces":{"hiding_nonce":"nonce_hiding","binding_nonce":"nonce_binding"},"commitments":{"hiding":"aaa111","binding":"bbb222"}}'
    ;;
  sign-round2)
    echo '{"signature_share":"share_local_01"}'
    ;;
  aggregate)
    echo '{"signature":"${FAKE_SIGNATURE}"}'
    ;;
  *)
    echo '{"error":"unknown command"}' >&2
    exit 1
    ;;
esac
`;
  writeFileSync(mockBinaryPath, script, { mode: 0o755 });
  _setFrostSignerPathForTest(mockBinaryPath);
}

function teardownMockBinary() {
  _setFrostSignerPathForTest(undefined as unknown as string | null);
  try { rmSync(mockDir, { recursive: true, force: true }); } catch { /* ok */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal FrostNodeConfig for testing. */
function makeNodeConfig(overrides?: Partial<FrostNodeConfig>): FrostNodeConfig {
  return {
    signer_index: 1,
    total_signers: 3,
    threshold: 2,
    key_package: { fake: "key_package_1" },
    pubkey_package: { fake: "pubkey_package" },
    group_pubkey: "aa".repeat(32),
    peers: [
      { signer_index: 1, endpoint: "http://localhost:19901" },
      { signer_index: 2, endpoint: "http://localhost:19902" },
      { signer_index: 3, endpoint: "http://localhost:19903" },
    ],
    ...overrides,
  };
}

/**
 * Create a Hono app that acts as a mock FROST signer peer.
 * Returns canned round1/round2 responses.
 */
function createMockPeerApp(opts: {
  signerIndex: number;
  round1Response?: { status: number; body: unknown };
  round2Response?: { status: number; body: unknown };
  round1Delay?: number;
  round2Delay?: number;
}) {
  const app = new Hono();

  app.post("/frost/signer/round1", async (c) => {
    if (opts.round1Delay) {
      await new Promise((r) => setTimeout(r, opts.round1Delay));
    }
    const resp = opts.round1Response ?? {
      status: 200,
      body: {
        commitments: opts.signerIndex === 2 ? FAKE_COMMITMENTS_PEER2 : FAKE_COMMITMENTS_PEER3,
        nonce_id: `nonce-${opts.signerIndex}-${crypto.randomUUID().slice(0, 8)}`,
      },
    };
    return c.json(resp.body as Record<string, unknown>, resp.status as 200);
  });

  app.post("/frost/signer/round2", async (c) => {
    if (opts.round2Delay) {
      await new Promise((r) => setTimeout(r, opts.round2Delay));
    }
    const resp = opts.round2Response ?? {
      status: 200,
      body: {
        signature_share: opts.signerIndex === 2 ? FAKE_SHARE_PEER2 : FAKE_SHARE_PEER3,
      },
    };
    return c.json(resp.body as Record<string, unknown>, resp.status as 200);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Replace global fetch to route peer HTTP calls to mock Hono apps
// ---------------------------------------------------------------------------

type FetchFn = typeof globalThis.fetch;

function installMockFetch(
  peerApps: Map<string, Hono>,
  originalFetch: FetchFn,
): void {
  (globalThis as { fetch: FetchFn }).fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    for (const [baseUrl, app] of peerApps) {
      if (url.startsWith(baseUrl)) {
        const path = url.slice(baseUrl.length);
        // Respect AbortSignal so timeout tests work correctly
        const signal = init?.signal;
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        const responsePromise = app.request(path, {
          method: init?.method ?? "GET",
          headers: init?.headers as Record<string, string>,
          body: init?.body as string,
        });
        if (signal) {
          return await Promise.race([
            responsePromise,
            new Promise<never>((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted", "AbortError"));
              });
            }),
          ]);
        }
        return responsePromise;
      }
    }
    // Fall through to original fetch (should not happen in tests)
    return originalFetch(input, init);
  };
}

function restoreFetch(original: FetchFn): void {
  (globalThis as { fetch: FetchFn }).fetch = original;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coordinateSigning", { sanitizeOps: false, sanitizeResources: false }, () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    restoreFetch(originalFetch);
    teardownMockBinary();
  });

  test("happy path: 2-of-3 signing succeeds", async () => {
    setupMockBinary();

    const peer2App = createMockPeerApp({ signerIndex: 2 });
    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19902", peer2App);
    installMockFetch(peerApps, originalFetch);

    const nodeConfig = makeNodeConfig();
    const config: SigningCoordinatorConfig = { nodeConfig };
    const messageHex = "deadbeef";

    const result = await coordinateSigning(config, messageHex);
    expect(result).not.toBeNull();
    expect(result!.signature).toBeDefined();
    expect(typeof result!.signature).toBe("string");
    expect(result!.signers_participated).toContain(1); // local
    expect(result!.signers_participated).toContain(2); // peer
    expect(result!.signers_participated).toHaveLength(2);
  });

  test("happy path: passes query and result to peers", async () => {
    setupMockBinary();

    let capturedBody: Record<string, unknown> | null = null;
    const customPeerApp = new Hono();
    customPeerApp.post("/frost/signer/round1", async (c) => {
      capturedBody = await c.req.json();
      return c.json({
        commitments: FAKE_COMMITMENTS_PEER2,
        nonce_id: "nonce-capture-test",
      });
    });
    customPeerApp.post("/frost/signer/round2", (c) => {
      return c.json({ signature_share: FAKE_SHARE_PEER2 });
    });

    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19902", customPeerApp);
    installMockFetch(peerApps, originalFetch);

    const nodeConfig = makeNodeConfig();
    const config: SigningCoordinatorConfig = {
      nodeConfig,
      query: { id: "q-test", description: "test query" },
      result: { value: 42 },
    };

    await coordinateSigning(config, "cafebabe");

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.message).toBe("cafebabe");
    expect(capturedBody!.query).toEqual({ id: "q-test", description: "test query" });
    expect(capturedBody!.result).toEqual({ value: 42 });
  });

  test("below threshold: only 1 peer responds (and it errors) -> returns null", async () => {
    setupMockBinary();

    // Peer 2 returns 500, peer 3 also returns 500
    const failPeer2 = createMockPeerApp({
      signerIndex: 2,
      round1Response: { status: 500, body: { error: "internal error" } },
    });
    const failPeer3 = createMockPeerApp({
      signerIndex: 3,
      round1Response: { status: 500, body: { error: "internal error" } },
    });

    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19902", failPeer2);
    peerApps.set("http://localhost:19903", failPeer3);
    installMockFetch(peerApps, originalFetch);

    const nodeConfig = makeNodeConfig();
    const config: SigningCoordinatorConfig = { nodeConfig };

    const result = await coordinateSigning(config, "deadbeef");
    expect(result).toBeNull();
  });

  test("peer timeout on round1: skipped, still succeeds if threshold met", async () => {
    setupMockBinary();

    // Peer 2 times out (delay longer than timeout), peer 3 responds normally
    const slowPeer = createMockPeerApp({ signerIndex: 2, round1Delay: 5000 });
    const fastPeer = createMockPeerApp({ signerIndex: 3 });

    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19902", slowPeer);
    peerApps.set("http://localhost:19903", fastPeer);
    installMockFetch(peerApps, originalFetch);

    const nodeConfig = makeNodeConfig();
    // Use short timeout so the slow peer is skipped
    const config: SigningCoordinatorConfig = { nodeConfig, peerTimeoutMs: 100 };

    const result = await coordinateSigning(config, "deadbeef");
    // Local (signer 1) + fast peer (signer 3) = 2 >= threshold
    expect(result).not.toBeNull();
    expect(result!.signers_participated).toContain(1);
    expect(result!.signers_participated).toContain(3);
    expect(result!.signers_participated).not.toContain(2);
  });

  test("round2 peer failure: below threshold -> returns null", async () => {
    setupMockBinary();

    // Peer 2 succeeds round1 but fails round2
    const peer2App = new Hono();
    peer2App.post("/frost/signer/round1", (c) =>
      c.json({ commitments: FAKE_COMMITMENTS_PEER2, nonce_id: "nonce-r2-fail" }),
    );
    peer2App.post("/frost/signer/round2", (c) =>
      c.json({ error: "round2 failed" }, 500),
    );

    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19902", peer2App);
    installMockFetch(peerApps, originalFetch);

    // Threshold 3 means we need all 3: local + peer2 + peer3
    // But peer3 is not reachable and peer2 fails round2
    const nodeConfig = makeNodeConfig({ threshold: 3 });
    const config: SigningCoordinatorConfig = { nodeConfig };

    const result = await coordinateSigning(config, "deadbeef");
    // We only get local commitment + peer2 commitment = 2 < threshold 3
    // So round1 already fails threshold check
    expect(result).toBeNull();
  });

  test("local signRound1 failure -> returns null", async () => {
    // Set binary to null so signRound1 returns { ok: false }
    _setFrostSignerPathForTest(null);

    const peerApps = new Map<string, Hono>();
    installMockFetch(peerApps, originalFetch);

    const nodeConfig = makeNodeConfig();
    const config: SigningCoordinatorConfig = { nodeConfig };

    const result = await coordinateSigning(config, "deadbeef");
    expect(result).toBeNull();
  });

  test("skips self in peer list", async () => {
    setupMockBinary();

    let peer1Called = false;
    const selfPeer = new Hono();
    selfPeer.post("/frost/signer/round1", (c) => {
      peer1Called = true;
      return c.json({ commitments: {}, nonce_id: "x" });
    });

    const peer2App = createMockPeerApp({ signerIndex: 2 });

    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19901", selfPeer);
    peerApps.set("http://localhost:19902", peer2App);
    installMockFetch(peerApps, originalFetch);

    const nodeConfig = makeNodeConfig();
    const config: SigningCoordinatorConfig = { nodeConfig };

    await coordinateSigning(config, "deadbeef");
    expect(peer1Called).toBe(false);
  });

  test("sends api_key header when configured", async () => {
    setupMockBinary();

    let capturedHeaders: Record<string, string> = {};
    const customPeerApp = new Hono();
    customPeerApp.post("/frost/signer/round1", async (c) => {
      capturedHeaders = Object.fromEntries(c.req.raw.headers.entries());
      return c.json({
        commitments: FAKE_COMMITMENTS_PEER2,
        nonce_id: "nonce-api-key-test",
      });
    });
    customPeerApp.post("/frost/signer/round2", (c) => {
      return c.json({ signature_share: FAKE_SHARE_PEER2 });
    });

    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19902", customPeerApp);
    installMockFetch(peerApps, originalFetch);

    const nodeConfig = makeNodeConfig({
      peers: [
        { signer_index: 1, endpoint: "http://localhost:19901" },
        { signer_index: 2, endpoint: "http://localhost:19902", api_key: "secret-key-42" },
      ],
    });
    const config: SigningCoordinatorConfig = { nodeConfig };

    await coordinateSigning(config, "cafebabe");

    expect(capturedHeaders["x-api-key"]).toBe("secret-key-42");
    expect(capturedHeaders["content-type"]).toBe("application/json");
  });

  test("stops collecting commitments once threshold is met", async () => {
    setupMockBinary();

    let peer3Called = false;
    const peer2App = createMockPeerApp({ signerIndex: 2 });
    const peer3App = new Hono();
    peer3App.post("/frost/signer/round1", (c) => {
      peer3Called = true;
      return c.json({ commitments: FAKE_COMMITMENTS_PEER3, nonce_id: "n3" });
    });

    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19902", peer2App);
    peerApps.set("http://localhost:19903", peer3App);
    installMockFetch(peerApps, originalFetch);

    // threshold=2, local + peer2 = 2, so peer3 should not be called
    const nodeConfig = makeNodeConfig({ threshold: 2 });
    const config: SigningCoordinatorConfig = { nodeConfig };

    const result = await coordinateSigning(config, "deadbeef");
    expect(result).not.toBeNull();
    // Peer 3 should not have been contacted since threshold was already met
    expect(peer3Called).toBe(false);
  });

  test("aggregation failure -> returns null", async () => {
    // Create a mock binary where aggregate returns an error
    mockDir = mkdtempSync(join(tmpdir(), "anchr-frost-coord-agg-fail-"));
    mockBinaryPath = join(mockDir, "frost-signer");
    const script = `#!/bin/sh
case "$1" in
  sign-round1)
    echo '{"nonces":{"hiding_nonce":"n1","binding_nonce":"n2"},"commitments":{"hiding":"h1","binding":"b1"}}'
    ;;
  sign-round2)
    echo '{"signature_share":"share_01"}'
    ;;
  aggregate)
    echo "aggregation error" >&2
    exit 1
    ;;
  *)
    echo '{"error":"unknown"}' >&2
    exit 1
    ;;
esac
`;
    writeFileSync(mockBinaryPath, script, { mode: 0o755 });
    _setFrostSignerPathForTest(mockBinaryPath);

    const peer2App = createMockPeerApp({ signerIndex: 2 });
    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19902", peer2App);
    installMockFetch(peerApps, originalFetch);

    const nodeConfig = makeNodeConfig();
    const config: SigningCoordinatorConfig = { nodeConfig };

    const result = await coordinateSigning(config, "deadbeef");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// identifierFromIndex (private, tested implicitly via coordination)
// ---------------------------------------------------------------------------

describe("identifierFromIndex (implicit)", () => {
  afterEach(() => {
    teardownMockBinary();
    restoreFetch(originalFetch);
  });

  const originalFetch = globalThis.fetch;

  test("signer_index 1 -> 64-char hex identifier '00...01'", async () => {
    setupMockBinary();

    // Capture what identifier is used for local commitments
    let capturedCommitmentsJson = "";
    const customPeerApp = new Hono();
    customPeerApp.post("/frost/signer/round1", (c) =>
      c.json({ commitments: FAKE_COMMITMENTS_PEER2, nonce_id: "n2" }),
    );
    customPeerApp.post("/frost/signer/round2", async (c) => {
      const body = await c.req.json<{ commitments: string }>();
      capturedCommitmentsJson = body.commitments;
      return c.json({ signature_share: FAKE_SHARE_PEER2 });
    });

    const peerApps = new Map<string, Hono>();
    peerApps.set("http://localhost:19902", customPeerApp);
    installMockFetch(peerApps, originalFetch);

    const nodeConfig = makeNodeConfig({ signer_index: 1 });
    const config: SigningCoordinatorConfig = { nodeConfig };

    await coordinateSigning(config, "aabb");

    // The local identifier for signer_index=1 should be "0000...0001" (64 chars)
    const commitments = JSON.parse(capturedCommitmentsJson);
    const expectedId = "0000000000000000000000000000000000000000000000000000000000000001";
    expect(commitments[expectedId]).toBeDefined();
  });
});
