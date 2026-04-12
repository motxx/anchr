/**
 * Standalone oracle HTTP server.
 *
 * Runs the same deterministic verification as the built-in oracle,
 * but as an independent HTTP service that workers can contact directly.
 *
 * Tor-compatible: stateless, no cookies, no identity tracking.
 *
 * Usage:
 *   ORACLE_PORT=4000 ORACLE_API_KEY=secret bun src/oracle/oracle-server.ts
 */

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { verify } from "../verification/verifier";
import type { Query, QueryResult } from "../../domain/types";
import type { OracleAttestation } from "../../domain/oracle-types";
import { createPreimageStore, createPersistentPreimageStore, type PreimageStore } from "../preimage/preimage-store";
import { createFrostCoordinator, type FrostCoordinator } from "../frost/coordinator";
import type { ThresholdOracleConfig } from "../../domain/oracle-types";
import type { FrostNodeConfig } from "../frost/config.ts";

// Timing-safe API key comparison following Cloudflare's recommended pattern.
// When lengths differ, compare the input against itself to maintain constant time
// without leaking the secret's length via response timing.
// https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/
const encoder = new TextEncoder();
function safeCompare(a: string, b: string): boolean {
  const userValue = encoder.encode(a);
  const secretValue = encoder.encode(b);
  const lengthsMatch = userValue.byteLength === secretValue.byteLength;
  return lengthsMatch
    ? timingSafeEqual(userValue, secretValue)
    : !timingSafeEqual(userValue, userValue);
}

const ORACLE_ID = process.env.ORACLE_ID ?? "remote-oracle";
const ORACLE_API_KEY = process.env.ORACLE_API_KEY?.trim();
const ORACLE_PORT = Number(process.env.ORACLE_PORT) || 4000;

export interface OracleAppOptions {
  oracleId?: string;
  apiKey?: string;
  preimageStore?: PreimageStore;
  /** FROST coordinator for threshold signing. */
  frostCoordinator?: FrostCoordinator;
  /** FROST threshold oracle config. */
  frostConfig?: ThresholdOracleConfig;
  /** Per-node FROST config (loaded from DKG-generated JSON). */
  frostNodeConfig?: FrostNodeConfig;
}

export function buildOracleApp(
  oracleIdOrOptions?: string | OracleAppOptions,
  apiKey?: string,
): Hono {
  const opts: OracleAppOptions = typeof oracleIdOrOptions === "string"
    ? { oracleId: oracleIdOrOptions, apiKey }
    : oracleIdOrOptions ?? {};

  const oracleId = opts.oracleId ?? ORACLE_ID;
  const resolvedApiKey = opts.apiKey ?? apiKey;
  const preimageStore = opts.preimageStore ?? createPreimageStore();
  const frostCoordinator = opts.frostCoordinator ?? createFrostCoordinator();
  const frostConfig = opts.frostConfig;
  const frostNodeConfig = opts.frostNodeConfig;
  const pendingNonces = new Map<string, string>();

  // Map queryId → hash for lookup by query ID
  const queryHashMap = new Map<string, string>();

  // Map queryId → worker pubkey (set only after POST /verify returns passed:true)
  const verifiedQueries = new Map<string, string>();

  const app = new Hono();

  // Auth middleware for protected endpoints
  const authMiddleware: MiddlewareHandler = async (c, next) => {
    if (!resolvedApiKey) return next();
    const auth = c.req.header("authorization");
    const key = c.req.header("x-api-key");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : key;
    if (!token || !safeCompare(token, resolvedApiKey)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };

  app.get("/health", (c) => c.json({ ok: true, oracle_id: oracleId }));

  app.get("/info", (c) =>
    c.json({
      id: oracleId,
      name: `Oracle ${oracleId}`,
      fee_ppm: Number(process.env.ORACLE_FEE_PPM) || 0,
    }),
  );

  /**
   * POST /hash — Generate HTLC preimage for a new query.
   *
   * Step 1 of the HTLC flow: Oracle generates preimage secretly,
   * returns hash(preimage) to the Requester.
   */
  app.post("/hash", authMiddleware, async (c) => {
    const body = await c.req.json<{ query_id: string }>().catch(() => null);
    if (!body?.query_id) {
      return c.json({ error: "Missing query_id" }, 400);
    }

    const existing = queryHashMap.get(body.query_id);
    if (existing) {
      return c.json({ query_id: body.query_id, hash: existing });
    }

    const entry = preimageStore.create();
    queryHashMap.set(body.query_id, entry.hash);
    return c.json({
      query_id: body.query_id,
      hash: entry.hash,
    }, 201);
  });

  /**
   * GET /hash/:queryId — Retrieve hash for a known query.
   */
  app.get("/hash/:queryId", authMiddleware, (c) => {
    const queryId = c.req.param("queryId");
    const hash = queryHashMap.get(queryId);
    if (!hash) return c.json({ error: "No hash found for this query" }, 404);
    return c.json({ query_id: queryId, hash });
  });

  /**
   * POST /verify — Run C2PA verification and return attestation.
   */
  app.post("/verify", authMiddleware, async (c) => {
    const body = await c.req.json<{ query: Query; result: QueryResult; worker_pubkey?: string }>();
    if (!body.query || !body.result) {
      return c.json({ error: "Missing query or result in request body" }, 400);
    }

    const detail = await verify(body.query, body.result);
    const attestation: OracleAttestation = {
      oracle_id: oracleId,
      query_id: body.query.id,
      passed: detail.passed,
      checks: detail.checks,
      failures: detail.failures,
      attested_at: Date.now(),
    };

    // Record verification result + worker pubkey for preimage gating
    if (detail.passed) {
      const workerPubkey = body.worker_pubkey ?? body.query.htlc?.worker_pubkey ?? "";
      verifiedQueries.set(body.query.id, workerPubkey);
    }

    return c.json(attestation);
  });

  /**
   * POST /preimage — Retrieve preimage after successful verification.
   *
   * The Oracle delivers the preimage only after C2PA verification passes.
   * In the Nostr-native flow, this is done via NIP-44 DM instead.
   */
  app.post("/preimage", authMiddleware, async (c) => {
    const body = await c.req.json<{ query_id: string; worker_pubkey?: string }>().catch(() => null);
    if (!body?.query_id) {
      return c.json({ error: "Missing query_id" }, 400);
    }

    // Only release preimage if verification passed
    const verifiedWorker = verifiedQueries.get(body.query_id);
    if (!verifiedWorker && verifiedWorker !== "") {
      return c.json({ error: "Verification has not passed for this query" }, 403);
    }

    // Verify caller is the selected Worker for this query (Spec 05)
    if (verifiedWorker && body.worker_pubkey && body.worker_pubkey !== verifiedWorker) {
      return c.json({ error: "Worker pubkey does not match selected worker" }, 403);
    }

    const hash = queryHashMap.get(body.query_id);
    if (!hash) {
      return c.json({ error: "No preimage found for this query" }, 404);
    }

    const preimage = preimageStore.getPreimage(hash);
    if (!preimage) {
      return c.json({ error: "No preimage found for this query" }, 404);
    }

    // Delete from all stores before responding to prevent replay (R-004)
    preimageStore.delete(hash);
    queryHashMap.delete(body.query_id);
    verifiedQueries.delete(body.query_id);

    return c.json({ query_id: body.query_id, preimage });
  });

  // --- FROST Signer endpoints (called by peer Oracle nodes during signing) ---

  /**
   * POST /frost/signer/round1 — Independent verification + nonce commitment.
   *
   * Each peer Oracle node independently verifies the query result before
   * producing nonce commitments. If verification fails, the peer refuses
   * to participate → the coordinator cannot reach threshold.
   */
  app.post("/frost/signer/round1", authMiddleware, async (c) => {
    const body = await c.req.json<{ message: string; query: Query; result: QueryResult }>().catch(() => null);
    if (!body?.message || !body?.query || !body?.result) {
      return c.json({ error: "Missing message, query, or result" }, 400);
    }
    if (!frostNodeConfig) return c.json({ error: "FROST not configured on this node" }, 503);

    // Mandatory independent verification — this is the security guarantee of threshold signing.
    // Without this check, a malicious coordinator could produce group signatures for garbage.
    const detail = await verify(body.query, body.result);
    if (!detail.passed) {
      return c.json({ error: "Verification failed", failures: detail.failures }, 403);
    }

    const { signRound1 } = await import("../frost/frost-cli.ts");
    const keyPackageJson = JSON.stringify(frostNodeConfig.key_package);
    const result = await signRound1(keyPackageJson);
    if (!result.ok) return c.json({ error: result.error }, 500);

    // Store nonces keyed by a random session ID (not message) to prevent nonce reuse.
    // Nonce reuse in Schnorr signing leaks the signer's secret key share.
    const nonceId = crypto.randomUUID();
    pendingNonces.set(nonceId, JSON.stringify(result.data!.nonces));

    return c.json({ commitments: result.data!.commitments, nonce_id: nonceId });
  });

  /** POST /frost/signer/round2 — Produce signature share using stored nonces. */
  app.post("/frost/signer/round2", authMiddleware, async (c) => {
    const body = await c.req.json<{ commitments: string; message: string; nonce_id: string }>().catch(() => null);
    if (!body?.commitments || !body?.message || !body?.nonce_id) {
      return c.json({ error: "Missing commitments, message, or nonce_id" }, 400);
    }
    if (!frostNodeConfig) return c.json({ error: "FROST not configured on this node" }, 503);

    const nonces = pendingNonces.get(body.nonce_id);
    if (!nonces) return c.json({ error: "Unknown or expired nonce_id" }, 409);
    pendingNonces.delete(body.nonce_id); // consume immediately — single use

    const { signRound2 } = await import("../frost/frost-cli.ts");
    const keyPackageJson = JSON.stringify(frostNodeConfig.key_package);
    const result = await signRound2(keyPackageJson, nonces, body.commitments, body.message);

    if (!result.ok) return c.json({ error: result.error }, 500);
    return c.json({ signature_share: result.data!.signature_share });
  });

  // --- FROST Threshold Signing API ---

  /**
   * POST /frost/dkg/init — Start a new DKG session.
   */
  app.post("/frost/dkg/init", authMiddleware, async (c) => {
    const body = await c.req.json<{ threshold: number; total: number }>().catch(() => null);
    if (!body?.threshold || !body?.total) {
      return c.json({ error: "Missing threshold or total" }, 400);
    }
    if (body.threshold > body.total) {
      return c.json({ error: "threshold cannot exceed total" }, 400);
    }

    const session = frostCoordinator.initDkg({ threshold: body.threshold, total: body.total });
    return c.json({
      session_id: session.session_id,
      threshold: session.threshold,
      total_signers: session.total_signers,
      current_round: session.current_round,
    }, 201);
  });

  /**
   * POST /frost/dkg/:sessionId/round/:n — Submit DKG round package.
   */
  app.post("/frost/dkg/:sessionId/round/:n", authMiddleware, async (c) => {
    const sessionId = c.req.param("sessionId");
    const round = Number(c.req.param("n")) as 1 | 2 | 3;
    if (![1, 2, 3].includes(round)) {
      return c.json({ error: "Round must be 1, 2, or 3" }, 400);
    }

    const body = await c.req.json<{
      signer_index: number;
      package: string;
      secret_package?: string;
    }>().catch(() => null);
    if (!body?.signer_index || !body?.package) {
      return c.json({ error: "Missing signer_index or package" }, 400);
    }

    const result = await frostCoordinator.submitDkgPackage(
      sessionId,
      round,
      body.signer_index,
      body.package,
      body.secret_package,
    );

    if (!result) {
      return c.json({ error: "DKG session not found" }, 404);
    }
    return c.json(result);
  });

  /**
   * GET /frost/dkg/:sessionId — Get DKG session state.
   */
  app.get("/frost/dkg/:sessionId", authMiddleware, (c) => {
    const session = frostCoordinator.getDkgSession(c.req.param("sessionId"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({
      session_id: session.session_id,
      threshold: session.threshold,
      total_signers: session.total_signers,
      current_round: session.current_round,
      group_pubkey: session.group_pubkey,
      round1_count: session.round1_packages.size,
      round2_count: session.round2_packages.size,
      key_packages_count: session.key_packages.size,
    });
  });

  /**
   * POST /frost/sign/:queryId — Start a FROST signing session.
   */
  app.post("/frost/sign/:queryId", authMiddleware, async (c) => {
    const queryId = c.req.param("queryId");
    const body = await c.req.json<{ message: string }>().catch(() => null);
    if (!body?.message) {
      return c.json({ error: "Missing message" }, 400);
    }

    if (!frostConfig) {
      return c.json({ error: "FROST not configured" }, 503);
    }

    const session = frostCoordinator.startSigning(queryId, body.message, frostConfig);
    return c.json({
      session_id: session.session_id,
      query_id: session.query_id,
      message: session.message,
      threshold: session.config.threshold,
    }, 201);
  });

  /**
   * POST /frost/sign/:queryId/commitments — Submit nonce commitment.
   */
  app.post("/frost/sign/:queryId/commitments", authMiddleware, async (c) => {
    const body = await c.req.json<{
      session_id: string;
      signer_pubkey: string;
      commitment: string;
    }>().catch(() => null);
    if (!body?.session_id || !body?.signer_pubkey || !body?.commitment) {
      return c.json({ error: "Missing session_id, signer_pubkey, or commitment" }, 400);
    }

    frostCoordinator.submitNonceCommitment(body.session_id, body.signer_pubkey, body.commitment);
    const session = frostCoordinator.getSigningSession(body.session_id);
    return c.json({
      commitments_count: session?.nonce_commitments.size ?? 0,
      threshold: session?.config.threshold ?? 0,
    });
  });

  /**
   * POST /frost/sign/:queryId/shares — Submit signature share.
   */
  app.post("/frost/sign/:queryId/shares", authMiddleware, async (c) => {
    const body = await c.req.json<{
      session_id: string;
      signer_pubkey: string;
      share: string;
    }>().catch(() => null);
    if (!body?.session_id || !body?.signer_pubkey || !body?.share) {
      return c.json({ error: "Missing session_id, signer_pubkey, or share" }, 400);
    }

    frostCoordinator.submitSignatureShare(body.session_id, body.signer_pubkey, body.share);
    const session = frostCoordinator.getSigningSession(body.session_id);

    // Auto-aggregate if threshold reached
    if (session && session.signature_shares.size >= session.config.threshold) {
      const aggResult = await frostCoordinator.tryAggregate(body.session_id);
      if (aggResult) {
        return c.json({
          shares_count: session.signature_shares.size,
          threshold: session.config.threshold,
          finalized: true,
          signature: aggResult.signature,
        });
      }
    }

    return c.json({
      shares_count: session?.signature_shares.size ?? 0,
      threshold: session?.config.threshold ?? 0,
      finalized: false,
    });
  });

  /**
   * GET /frost/sign/:queryId — Get signing session state.
   */
  app.get("/frost/sign/:queryId", authMiddleware, (c) => {
    const queryId = c.req.param("queryId");
    // Find session by queryId
    // Note: In a full impl, we'd have a reverse map. For now, iterate.
    let found: ReturnType<typeof frostCoordinator.getSigningSession>;
    // Try direct session ID lookup first, then search
    found = frostCoordinator.getSigningSession(queryId);

    if (!found) {
      return c.json({ error: "Signing session not found" }, 404);
    }

    return c.json({
      session_id: found.session_id,
      query_id: found.query_id,
      message: found.message,
      threshold: found.config.threshold,
      commitments_count: found.nonce_commitments.size,
      shares_count: found.signature_shares.size,
      finalized: found.finalized,
      signature: found.group_signature,
    });
  });

  return app;
}

// Run as standalone server when executed directly
if (import.meta.main) {
  const preimageDbPath = process.env.ORACLE_PREIMAGE_DB?.trim();
  const preimageStore = preimageDbPath
    ? createPersistentPreimageStore(preimageDbPath)
    : undefined;

  // Load FROST config if available
  let frostNodeConfig: FrostNodeConfig | undefined;
  let frostConfig: ThresholdOracleConfig | undefined;
  const frostConfigPath = process.env.FROST_CONFIG_PATH?.trim();
  if (frostConfigPath) {
    try {
      const { loadFrostNodeConfig, toThresholdOracleConfig } = await import("../frost/config.ts");
      frostNodeConfig = loadFrostNodeConfig(frostConfigPath);
      frostConfig = toThresholdOracleConfig(frostNodeConfig);
      console.log(`[oracle-server] FROST ${frostNodeConfig.threshold}-of-${frostNodeConfig.total_signers} loaded (group_pubkey=${frostNodeConfig.group_pubkey.slice(0, 16)}...)`);
    } catch (e) {
      console.error(`[oracle-server] Failed to load FROST config from ${frostConfigPath}:`, e);
    }
  }

  const app = buildOracleApp({
    oracleId: ORACLE_ID,
    apiKey: ORACLE_API_KEY,
    preimageStore,
    frostCoordinator: frostConfig ? createFrostCoordinator() : undefined,
    frostConfig,
    frostNodeConfig,
  });

  if (preimageDbPath) {
    console.log(`[oracle-server] Preimage store persisted to ${preimageDbPath}`);
  }
  console.log(`[oracle-server] Starting oracle "${ORACLE_ID}" on port ${ORACLE_PORT}`);

  Deno.serve({ port: ORACLE_PORT }, app.fetch);
}
