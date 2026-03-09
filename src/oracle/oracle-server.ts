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

import { Hono } from "hono";
import { verify } from "../verification/verifier";
import type { Query, QueryResult } from "../types";
import type { OracleAttestation } from "./types";

const ORACLE_ID = process.env.ORACLE_ID ?? "remote-oracle";
const ORACLE_API_KEY = process.env.ORACLE_API_KEY?.trim();
const ORACLE_PORT = Number(process.env.ORACLE_PORT) || 4000;

export function buildOracleApp(oracleId: string = ORACLE_ID, apiKey?: string): Hono {
  const app = new Hono();

  // Auth middleware (optional)
  if (apiKey) {
    app.use("/verify", async (c, next) => {
      const auth = c.req.header("authorization");
      const key = c.req.header("x-api-key");
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : key;
      if (token !== apiKey) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    });
  }

  app.get("/health", (c) => c.json({ ok: true, oracle_id: oracleId }));

  app.get("/info", (c) =>
    c.json({
      id: oracleId,
      name: `Oracle ${oracleId}`,
      fee_ppm: Number(process.env.ORACLE_FEE_PPM) || 0,
    }),
  );

  app.post("/verify", async (c) => {
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

    return c.json(attestation);
  });

  return app;
}

// Run as standalone server when executed directly
if (import.meta.main) {
  const app = buildOracleApp(ORACLE_ID, ORACLE_API_KEY);
  console.log(`[oracle-server] Starting oracle "${ORACLE_ID}" on port ${ORACLE_PORT}`);

  Bun.serve({
    port: ORACLE_PORT,
    fetch: app.fetch,
  });
}
