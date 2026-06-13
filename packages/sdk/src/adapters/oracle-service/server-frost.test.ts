import { afterAll, beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Hono } from "hono";
import { getEncodedToken, type Proof } from "@cashu/cashu-ts";
import { buildOracleApp } from "./server.ts";
import { buildAuthMiddleware } from "./auth.ts";
import {
  type PendingNonceSession,
  registerFrostSignerRoutes,
} from "./frost-signer-routes.ts";
import {
  createFrostCoordinator,
  deriveFrostEscrowTokenHash,
  deriveFrostP2pkMessages,
  deriveFrostSigningMessage,
} from "../../payments/mod.ts";
import type {
  FrostNodeConfig,
  ThresholdOracleConfig,
} from "../../payments/mod.ts";

const API_KEY = "frost-test-key";
const KEYSET_ID = "00ad268c4d1f5826";

const authHeaders = (extra?: Record<string, string>) => ({
  "authorization": `Bearer ${API_KEY}`,
  "content-type": "application/json",
  ...extra,
});

const frostConfig: ThresholdOracleConfig = {
  threshold: 2,
  total_signers: 3,
  signer_pubkeys: ["pub1", "pub2", "pub3"],
  group_pubkey: "aabb".repeat(16),
};

// --- DKG endpoints ---

describe("oracle-server FROST DKG endpoints", () => {
  const coordinator = createFrostCoordinator();
  const app = buildOracleApp({
    oracleId: "test-oracle",
    apiKey: API_KEY,
    frostCoordinator: coordinator,
  });

  test("POST /frost/dkg/init returns 201 with session_id, threshold, total_signers", async () => {
    const res = await app.request("/frost/dkg/init", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ threshold: 2, total: 3 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.session_id).toBe("string");
    expect(body.session_id.length).toBeGreaterThan(0);
    expect(body.threshold).toBe(2);
    expect(body.total_signers).toBe(3);
    expect(body.current_round).toBe(0);
  });

  test("POST /frost/dkg/init rejects threshold > total (400)", async () => {
    const res = await app.request("/frost/dkg/init", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ threshold: 5, total: 3 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("threshold");
  });

  test("POST /frost/dkg/init rejects missing params (400)", async () => {
    const res = await app.request("/frost/dkg/init", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("GET /frost/dkg/:sessionId returns session state", async () => {
    // Create a session first
    const createRes = await app.request("/frost/dkg/init", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ threshold: 2, total: 3 }),
    });
    const created = await createRes.json();

    const res = await app.request(`/frost/dkg/${created.session_id}`, {
      headers: { "authorization": `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe(created.session_id);
    expect(body.threshold).toBe(2);
    expect(body.total_signers).toBe(3);
    expect(body.current_round).toBe(0);
    expect(body.round1_count).toBe(0);
    expect(body.round2_count).toBe(0);
    expect(body.key_packages_count).toBe(0);
  });

  test("GET /frost/dkg/:sessionId returns 404 for unknown session", async () => {
    const res = await app.request("/frost/dkg/nonexistent-session-id", {
      headers: { "authorization": `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("POST /frost/dkg/:sessionId/round/1 accepts package submission", async () => {
    // Create a session first
    const createRes = await app.request("/frost/dkg/init", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ threshold: 2, total: 3 }),
    });
    const created = await createRes.json();

    const res = await app.request(`/frost/dkg/${created.session_id}/round/1`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        signer_index: 1,
        package: '{"round1_data":"test"}',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.round).toBe(1);
    expect(body.complete).toBe(false);
  });

  test("POST /frost/dkg/:sessionId/round/4 rejects invalid round (400)", async () => {
    const createRes = await app.request("/frost/dkg/init", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ threshold: 2, total: 3 }),
    });
    const created = await createRes.json();

    const res = await app.request(`/frost/dkg/${created.session_id}/round/4`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        signer_index: 1,
        package: '{"round4_data":"test"}',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Round");
  });
});

// --- Signing endpoints ---

describe("oracle-server FROST signing endpoints", () => {
  test("POST /frost/sign/:queryId returns 503 when frostConfig is not set", async () => {
    const coordinator = createFrostCoordinator();
    const app = buildOracleApp({
      oracleId: "test-oracle",
      apiKey: API_KEY,
      frostCoordinator: coordinator,
      // No frostConfig
    });

    const res = await app.request("/frost/sign/q-test", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "deadbeef" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("FROST not configured");
  });

  test("POST /frost/sign/:queryId returns 201 with session when frostConfig is set", async () => {
    const coordinator = createFrostCoordinator();
    const app = buildOracleApp({
      oracleId: "test-oracle",
      apiKey: API_KEY,
      frostCoordinator: coordinator,
      frostConfig,
    });

    const res = await app.request("/frost/sign/q-sign-1", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "deadbeef" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.session_id).toBe("string");
    expect(body.query_id).toBe("q-sign-1");
    expect(body.message).toBe("deadbeef");
    expect(body.threshold).toBe(2);
  });

  test("POST /frost/sign/:queryId/commitments accepts commitment", async () => {
    const coordinator = createFrostCoordinator();
    const app = buildOracleApp({
      oracleId: "test-oracle",
      apiKey: API_KEY,
      frostCoordinator: coordinator,
      frostConfig,
    });

    // Start a signing session first
    const signRes = await app.request("/frost/sign/q-commit-1", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "deadbeef" }),
    });
    const session = await signRes.json();

    const res = await app.request("/frost/sign/q-commit-1/commitments", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        session_id: session.session_id,
        signer_pubkey: "pub1",
        commitment: '{"nonce":"abc123"}',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commitments_count).toBe(1);
    expect(body.threshold).toBe(2);
  });

  test("POST /frost/sign/:queryId/shares accepts share", async () => {
    const coordinator = createFrostCoordinator();
    const app = buildOracleApp({
      oracleId: "test-oracle",
      apiKey: API_KEY,
      frostCoordinator: coordinator,
      frostConfig,
    });

    // Start a signing session
    const signRes = await app.request("/frost/sign/q-share-1", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "deadbeef" }),
    });
    const session = await signRes.json();

    const res = await app.request("/frost/sign/q-share-1/shares", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        session_id: session.session_id,
        signer_pubkey: "pub1",
        share: '{"signature_share":"aabbcc"}',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shares_count).toBe(1);
    expect(body.threshold).toBe(2);
    expect(body.finalized).toBe(false);
  });
});

// --- Signer message binding (round 1 verified requirement → round 2 message) ---

describe("oracle-server FROST signer message binding", () => {
  const frostNodeConfig: FrostNodeConfig = {
    signer_index: 1,
    total_signers: 3,
    threshold: 2,
    key_package: {},
    pubkey_package: {},
    group_pubkey: "aa".repeat(32),
    peers: [],
  };

  function buildSignerApp(pendingNonces: Map<string, PendingNonceSession>) {
    const app = new Hono();
    registerFrostSignerRoutes(app, {
      authMiddleware: buildAuthMiddleware(API_KEY),
      frostNodeConfig,
      pendingNonces,
    });
    return app;
  }

  function makeP2pkToken(params: {
    groupPubkey: string;
    nSigs: string;
  }): string {
    const proof: Proof = {
      amount: 1,
      id: KEYSET_ID,
      secret: JSON.stringify([
        "P2PK",
        {
          data: "02" + "11".repeat(32),
          nonce: "testnonce",
          tags: [
            ["pubkeys", `02${params.groupPubkey}`],
            ["n_sigs", params.nSigs],
            ["sigflag", "SIG_INPUTS"],
          ],
        },
      ]),
      C: "02" + "22".repeat(32),
    };
    return getEncodedToken({ mint: "https://mint.example", proofs: [proof] }, {
      version: 4,
    });
  }

  test("round1 rejects a message that does not match the verified requirement (403)", async () => {
    const pendingNonces = new Map<string, PendingNonceSession>();
    const app = buildSignerApp(pendingNonces);

    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        message: "deadbeef",
        requirement: { id: "q-bind", factors: [] },
        input: {
          attachments: [{
            id: "att-bind",
            uri: "https://blossom.example/att-bind",
            mime_type: "image/jpeg",
            storage_kind: "blossom",
          }],
          schema_evidence: {},
        },
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("does not match");
    expect(pendingNonces.size).toBe(0);
  });

  test("round1 rejects a token-bound P2PK message without a matching token hash", async () => {
    const pendingNonces = new Map<string, PendingNonceSession>();
    const app = buildSignerApp(pendingNonces);
    const token = makeP2pkToken({
      groupPubkey: frostNodeConfig.group_pubkey,
      nSigs: "2",
    });

    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        message: deriveFrostP2pkMessages(token)[0],
        requirement: {
          id: "q-bind",
          factors: [],
          escrow_token_hash: "00".repeat(32),
        },
        input: {
          attachments: [{
            id: "att-bind",
            uri: "https://blossom.example/att-bind",
            mime_type: "image/jpeg",
            storage_kind: "blossom",
          }],
          schema_evidence: {},
        },
        escrow_token: token,
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("does not match");
    expect(pendingNonces.size).toBe(0);
  });

  test("round1 rejects a token-bound P2PK message when the group key is not in the lock", async () => {
    const pendingNonces = new Map<string, PendingNonceSession>();
    const app = buildSignerApp(pendingNonces);
    const token = makeP2pkToken({ groupPubkey: "33".repeat(32), nSigs: "2" });

    const res = await app.request("/frost/signer/round1", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        message: deriveFrostP2pkMessages(token)[0],
        requirement: {
          id: "q-bind",
          factors: [],
          escrow_token_hash: deriveFrostEscrowTokenHash(token),
        },
        input: {
          attachments: [{
            id: "att-bind",
            uri: "https://blossom.example/att-bind",
            mime_type: "image/jpeg",
            storage_kind: "blossom",
          }],
          schema_evidence: {},
        },
        escrow_token: token,
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("does not match");
    expect(pendingNonces.size).toBe(0);
  });

  test("round2 with a mismatched message returns 403 and no signature share", async () => {
    const pendingNonces = new Map<string, PendingNonceSession>();
    pendingNonces.set("session-1", {
      noncesJson: "{}",
      messageHex: deriveFrostSigningMessage("q-bind"),
    });
    const app = buildSignerApp(pendingNonces);

    const res = await app.request("/frost/signer/round2", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        commitments: "{}",
        message: "deadbeef",
        nonce_id: "session-1",
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.signature_share).toBeUndefined();
    expect(body.error).toContain("round-1");
    // The nonce session is consumed even on rejection — no replay probing.
    expect(pendingNonces.size).toBe(0);
  });
});

// --- Auth middleware ---

describe("oracle-server FROST auth middleware", () => {
  const coordinator = createFrostCoordinator();
  const app = buildOracleApp({
    oracleId: "test-oracle",
    apiKey: API_KEY,
    frostCoordinator: coordinator,
  });

  test("POST /frost/dkg/init rejects unauthenticated requests", async () => {
    const res = await app.request("/frost/dkg/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threshold: 2, total: 3 }),
    });
    expect(res.status).toBe(401);
  });

  test("GET /frost/dkg/:sessionId rejects unauthenticated requests", async () => {
    const res = await app.request("/frost/dkg/some-session-id", {});
    expect(res.status).toBe(401);
  });

  test("POST /frost/sign/:queryId rejects unauthenticated requests", async () => {
    const res = await app.request("/frost/sign/q-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "deadbeef" }),
    });
    expect(res.status).toBe(401);
  });

  test("FROST endpoints accept X-API-Key header", async () => {
    const res = await app.request("/frost/dkg/init", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ threshold: 2, total: 3 }),
    });
    expect(res.status).toBe(201);
  });
});
