import { afterAll, beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildOracleApp } from "./oracle-server";
import { createFrostCoordinator } from "../frost/coordinator";
import type { ThresholdOracleConfig } from "../../domain/oracle-types";

const API_KEY = "frost-test-key";

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
