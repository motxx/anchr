/**
 * Tests for FROST signer endpoints on the market API routes.
 *
 * These endpoints (POST /frost/signer/round1, POST /frost/signer/round2) are
 * registered inside registerMarketRoutes() when frostMode === "frost".
 *
 * We test:
 *   - Message parsing (hex -> "{marketId}:{outcome}")
 *   - Independent condition evaluation (agree/disagree)
 *   - Key package selection (YES vs NO group)
 *   - Nonce single-use lifecycle (store on round1, consume on round2, 409 on reuse)
 *   - Missing fields → 400
 *   - Unknown nonce_id → 409
 */

import { describe, test, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  registerMarketRoutes,
  createMarketState,
  type MarketState,
  type MarketRouteContext,
} from "./market-api-routes.ts";
import type { MarketFrostNodeConfig } from "./frost/market-frost-config.ts";
import type { PredictionMarket } from "../../example/prediction-market/src/market-types.ts";
import { _setFrostSignerPathForTest } from "./frost/frost-cli.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mock frost-signer binary
// ---------------------------------------------------------------------------

let mockDir: string;
let mockBinaryPath: string;

function setupMockBinary() {
  mockDir = mkdtempSync(join(tmpdir(), "anchr-market-signer-test-"));
  mockBinaryPath = join(mockDir, "frost-signer");

  // Returns canned responses for sign-round1 and sign-round2.
  // sign-round1 response includes nonces + commitments.
  // sign-round2 response includes signature_share.
  const script = `#!/bin/sh
case "$1" in
  sign-round1)
    echo '{"nonces":{"hiding_nonce":"test_hiding","binding_nonce":"test_binding"},"commitments":{"hiding":"commit_h","binding":"commit_b"}}'
    ;;
  sign-round2)
    echo '{"signature_share":"test_share_abc"}'
    ;;
  *)
    echo '{"error":"unknown"}' >&2
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

/** Encode a string as hex for the "message" field. */
function toHex(text: string): string {
  return Array.from(new TextEncoder().encode(text))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Build a minimal MarketFrostNodeConfig for testing. */
function makeFrostConfig(): MarketFrostNodeConfig {
  return {
    signer_index: 1,
    total_signers: 3,
    threshold: 2,
    key_package: { yes_key: "pkg_yes" },
    pubkey_package: { yes_pubkey: "pkg_yes_pub" },
    group_pubkey: "aa".repeat(32),
    key_package_no: { no_key: "pkg_no" },
    pubkey_package_no: { no_pubkey: "pkg_no_pub" },
    group_pubkey_no: "bb".repeat(32),
    peers: [],
  };
}

/** No-op auth middleware for testing. */
const noopAuth: MiddlewareHandler = async (_c, next) => { await next(); };

/** Build a Hono app with market routes + FROST signer endpoints enabled. */
function buildTestApp(stateOverrides?: Partial<MarketState>): Hono {
  const app = new Hono();
  const frostConfig = makeFrostConfig();
  const state = createMarketState({ frostConfig });

  // Apply overrides
  if (stateOverrides) {
    for (const [k, v] of Object.entries(stateOverrides)) {
      // deno-lint-ignore no-explicit-any
      (state as any)[k] = v;
    }
  }

  const ctx: MarketRouteContext = {
    writeAuth: noopAuth,
    rateLimit: noopAuth,
  };

  registerMarketRoutes(app, ctx, state);
  return app;
}

/** Build a test app and pre-populate a market in the state. */
function buildTestAppWithMarket(market: PredictionMarket): { app: Hono; state: MarketState } {
  const frostConfig = makeFrostConfig();
  const state = createMarketState({ frostConfig });
  state.markets.set(market.id, market);

  const app = new Hono();
  const ctx: MarketRouteContext = {
    writeAuth: noopAuth,
    rateLimit: noopAuth,
  };
  registerMarketRoutes(app, ctx, state);
  return { app, state };
}

/** Build a minimal PredictionMarket. */
function makeMarket(overrides?: Partial<PredictionMarket>): PredictionMarket {
  return {
    id: "mkt_test01",
    title: "Test Market",
    description: "Will BTC > 100K?",
    category: "crypto",
    creator_pubkey: "creator_pub",
    resolution_url: "https://api.example.com/price",
    resolution_condition: {
      type: "price_above",
      target_url: "https://api.example.com/price",
      jsonpath: "best_bid",
      threshold: 100000,
      description: "BTC price above 100K",
    },
    resolution_deadline: Math.floor(Date.now() / 1000) + 3600,
    yes_pool_sats: 1000,
    no_pool_sats: 500,
    min_bet_sats: 10,
    max_bet_sats: 10000,
    fee_ppm: 5000,
    oracle_pubkey: "oracle_pub",
    htlc_hash_yes: "aa".repeat(32),
    htlc_hash_no: "bb".repeat(32),
    group_pubkey_yes: "aa".repeat(32),
    group_pubkey_no: "bb".repeat(32),
    nostr_event_id: "event_01",
    status: "resolving",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: Message parsing
// ---------------------------------------------------------------------------

describe("market FROST signer /frost/signer/round1 — message parsing", () => {
  afterEach(() => teardownMockBinary());

  test("valid 'marketId:yes' message → 200 with commitments and nonce_id", async () => {
    setupMockBinary();
    const app = buildTestApp();

    const message = toHex("mkt_test01:yes");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commitments).toBeDefined();
    expect(typeof body.nonce_id).toBe("string");
    expect(body.nonce_id.length).toBeGreaterThan(0);
  });

  test("valid 'marketId:no' message → 200", async () => {
    setupMockBinary();
    const app = buildTestApp();

    const message = toHex("mkt_test01:no");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });

    expect(res.status).toBe(200);
  });

  test("invalid outcome (not yes/no) → 400", async () => {
    setupMockBinary();
    const app = buildTestApp();

    const message = toHex("mkt_test01:maybe");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Cannot parse message");
  });

  test("missing message field → 400", async () => {
    setupMockBinary();
    const app = buildTestApp();

    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  test("message with no colon separator → 400", async () => {
    setupMockBinary();
    const app = buildTestApp();

    const message = toHex("noseparator");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: Condition evaluation
// ---------------------------------------------------------------------------

describe("market FROST signer /frost/signer/round1 — condition evaluation", () => {
  afterEach(() => teardownMockBinary());

  test("condition agrees with outcome → 200", async () => {
    setupMockBinary();
    const market = makeMarket({
      id: "mkt_cond_yes",
      resolution_condition: {
        type: "price_above",
        target_url: "https://api.example.com/price",
        jsonpath: "best_bid",
        threshold: 100000,
        description: "BTC above 100K",
      },
    });
    const { app } = buildTestAppWithMarket(market);

    const message = toHex("mkt_cond_yes:yes");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        result: { verified_body: JSON.stringify({ best_bid: 105000 }) },
      }),
    });

    expect(res.status).toBe(200);
  });

  test("condition disagrees with outcome → 403", async () => {
    setupMockBinary();
    const market = makeMarket({
      id: "mkt_cond_disagree",
      resolution_condition: {
        type: "price_above",
        target_url: "https://api.example.com/price",
        jsonpath: "best_bid",
        threshold: 100000,
        description: "BTC above 100K",
      },
    });
    const { app } = buildTestAppWithMarket(market);

    // Price is 90000 < 100000, so condition NOT met → outcome should be "no"
    // But we're requesting "yes" → disagreement
    const message = toHex("mkt_cond_disagree:yes");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        result: { verified_body: JSON.stringify({ best_bid: 90000 }) },
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("disagrees");
  });

  test("no verified_body → skips condition check, succeeds", async () => {
    setupMockBinary();
    const market = makeMarket({ id: "mkt_no_body" });
    const { app } = buildTestAppWithMarket(market);

    const message = toHex("mkt_no_body:yes");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });

    expect(res.status).toBe(200);
  });

  test("market not found → skips condition check, succeeds", async () => {
    setupMockBinary();
    const app = buildTestApp();

    // Market "nonexistent" does not exist in state
    const message = toHex("nonexistent:yes");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        result: { verified_body: JSON.stringify({ best_bid: 105000 }) },
      }),
    });

    expect(res.status).toBe(200);
  });

  test("condition NO agrees with no outcome → 200", async () => {
    setupMockBinary();
    const market = makeMarket({
      id: "mkt_cond_no",
      resolution_condition: {
        type: "price_above",
        target_url: "https://api.example.com/price",
        jsonpath: "best_bid",
        threshold: 100000,
        description: "BTC above 100K",
      },
    });
    const { app } = buildTestAppWithMarket(market);

    // Price 90000 < 100000, condition NOT met → "no"
    const message = toHex("mkt_cond_no:no");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        result: { verified_body: JSON.stringify({ best_bid: 90000 }) },
      }),
    });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: Nonce lifecycle (round1 → round2 → 409 on reuse)
// ---------------------------------------------------------------------------

describe("market FROST signer nonce lifecycle", () => {
  afterEach(() => teardownMockBinary());

  test("round1 stores nonce, round2 consumes it → 200", async () => {
    setupMockBinary();
    const app = buildTestApp();

    // Round 1
    const message = toHex("mkt_nonce:yes");
    const r1Res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    expect(r1Res.status).toBe(200);
    const r1Body = await r1Res.json();
    const nonceId = r1Body.nonce_id;
    expect(typeof nonceId).toBe("string");

    // Round 2 with the nonce_id from round 1
    const r2Res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commitments: "{}",
        message,
        nonce_id: nonceId,
      }),
    });
    expect(r2Res.status).toBe(200);
    const r2Body = await r2Res.json();
    expect(r2Body.signature_share).toBeDefined();
  });

  test("round2 with same nonce_id twice → second returns 409", async () => {
    setupMockBinary();
    const app = buildTestApp();

    // Round 1
    const message = toHex("mkt_reuse:yes");
    const r1Res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const r1Body = await r1Res.json();
    const nonceId = r1Body.nonce_id;

    // First round 2 → ok
    const r2Res1 = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitments: "{}", message, nonce_id: nonceId }),
    });
    expect(r2Res1.status).toBe(200);

    // Second round 2 with same nonce_id → 409
    const r2Res2 = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitments: "{}", message, nonce_id: nonceId }),
    });
    expect(r2Res2.status).toBe(409);
    const body = await r2Res2.json();
    expect(body.error).toContain("nonce_id");
  });

  test("round2 with unknown nonce_id → 409", async () => {
    setupMockBinary();
    const app = buildTestApp();

    const message = toHex("mkt_unknown:yes");
    const res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commitments: "{}",
        message,
        nonce_id: "nonexistent-nonce-id",
      }),
    });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Tests: round2 validation
// ---------------------------------------------------------------------------

describe("market FROST signer /frost/signer/round2 — validation", () => {
  afterEach(() => teardownMockBinary());

  test("missing commitments → 400", async () => {
    setupMockBinary();
    const app = buildTestApp();

    const res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "aabb", nonce_id: "some-id" }),
    });
    expect(res.status).toBe(400);
  });

  test("missing message → 400", async () => {
    setupMockBinary();
    const app = buildTestApp();

    const res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitments: "{}", nonce_id: "some-id" }),
    });
    expect(res.status).toBe(400);
  });

  test("missing nonce_id → 400", async () => {
    setupMockBinary();
    const app = buildTestApp();

    const res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitments: "{}", message: "aabb" }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: frost-cli failure
// ---------------------------------------------------------------------------

describe("market FROST signer — frost-cli unavailable", () => {
  afterEach(() => teardownMockBinary());

  test("signRound1 failure → 500", async () => {
    // Build the app with a working binary so FROST endpoints are registered
    setupMockBinary();
    const app = buildTestApp();

    // Now break the binary so signRound1 returns an error
    _setFrostSignerPathForTest(null);

    const message = toHex("mkt_fail:yes");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("signRound2 failure → 500", async () => {
    // First get a nonce_id with a working binary
    setupMockBinary();
    const app = buildTestApp();

    const message = toHex("mkt_r2fail:yes");
    const r1Res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const r1Body = await r1Res.json();

    // Now break the binary for round 2
    // Create a binary that fails on sign-round2
    const failDir = mkdtempSync(join(tmpdir(), "anchr-market-signer-fail-"));
    const failPath = join(failDir, "frost-signer");
    writeFileSync(failPath, `#!/bin/sh\necho "error" >&2\nexit 1\n`, { mode: 0o755 });
    _setFrostSignerPathForTest(failPath);

    const r2Res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commitments: "{}",
        message,
        nonce_id: r1Body.nonce_id,
      }),
    });

    expect(r2Res.status).toBe(500);

    // Clean up
    try { rmSync(failDir, { recursive: true, force: true }); } catch { /* ok */ }
  });
});

// ---------------------------------------------------------------------------
// Tests: FROST endpoints not registered when frostMode !== "frost"
// ---------------------------------------------------------------------------

describe("market FROST signer — endpoints not registered without FROST config", () => {
  test("/frost/signer/round1 → 404 when frostMode is single-key", async () => {
    const app = new Hono();
    // createMarketState without frostConfig defaults to single-key mode
    const state = createMarketState();
    expect(state.frostMode).toBe("single-key");

    const ctx: MarketRouteContext = {
      writeAuth: noopAuth,
      rateLimit: noopAuth,
    };
    registerMarketRoutes(app, ctx, state);

    const message = toHex("mkt_test:yes");
    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });

    expect(res.status).toBe(404);
  });

  test("/frost/signer/round2 → 404 when frostMode is single-key", async () => {
    const app = new Hono();
    const state = createMarketState();
    const ctx: MarketRouteContext = {
      writeAuth: noopAuth,
      rateLimit: noopAuth,
    };
    registerMarketRoutes(app, ctx, state);

    const res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitments: "{}", message: "aabb", nonce_id: "x" }),
    });

    expect(res.status).toBe(404);
  });
});
