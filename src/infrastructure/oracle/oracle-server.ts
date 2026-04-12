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
import { createPreimageStore, createPersistentPreimageStore, type PreimageStore } from "../cashu/preimage-store";

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

  // Map queryId → hash for lookup by query ID
  const queryHashMap = new Map<string, string>();

  // Map queryId → verified status (true only after POST /verify returns passed:true)
  const verifiedQueries = new Map<string, boolean>();

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
    const body = await c.req.json<{ query: Query; result: QueryResult }>();
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

    // Record verification result for preimage gating
    if (detail.passed) {
      verifiedQueries.set(body.query.id, true);
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
    const body = await c.req.json<{ query_id: string }>().catch(() => null);
    if (!body?.query_id) {
      return c.json({ error: "Missing query_id" }, 400);
    }

    // Only release preimage if verification passed
    if (!verifiedQueries.get(body.query_id)) {
      return c.json({ error: "Verification has not passed for this query" }, 403);
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

  return app;
}

// Run as standalone server when executed directly
if (import.meta.main) {
  const preimageDbPath = process.env.ORACLE_PREIMAGE_DB?.trim();
  const preimageStore = preimageDbPath
    ? createPersistentPreimageStore(preimageDbPath)
    : undefined;

  const app = buildOracleApp({
    oracleId: ORACLE_ID,
    apiKey: ORACLE_API_KEY,
    preimageStore,
  });

  if (preimageDbPath) {
    console.log(`[oracle-server] Preimage store persisted to ${preimageDbPath}`);
  }
  console.log(`[oracle-server] Starting oracle "${ORACLE_ID}" on port ${ORACLE_PORT}`);

  Deno.serve({ port: ORACLE_PORT }, app.fetch);
}
