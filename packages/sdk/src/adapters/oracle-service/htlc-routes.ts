import type { Hono, MiddlewareHandler } from "hono";
import { verify } from "../../requests/application/query-verifier.ts";
import type { Query, QueryResult } from "../../requests/domain/types.ts";
import type { OracleAttestation } from "../../requests/domain/oracle-types.ts";
import { issueQueryHash, type PreimageStore } from "../../payments/mod.ts";

export interface HtlcRouteDeps {
  oracleId: string;
  authMiddleware: MiddlewareHandler;
  preimageStore: PreimageStore;
  queryHashMap: Map<string, string>;
}

/**
 * Register the HTLC proof-gated flow on the given Hono app:
 *   POST /hash            — generate preimage, return hash
 *   GET  /hash/:queryId   — read hash for a known query
 *   POST /verify          — run verification and return attestation
 */
export function registerHtlcRoutes(app: Hono, deps: HtlcRouteDeps): void {
  const {
    authMiddleware,
    preimageStore,
    queryHashMap,
    oracleId,
  } = deps;

  app.post("/hash", authMiddleware, async (c) => {
    const body = await c.req.json<{ query_id: string }>().catch(() => null);
    if (!body?.query_id) {
      return c.json({ error: "Missing query_id" }, 400);
    }

    const issued = issueQueryHash(preimageStore, queryHashMap, body.query_id);
    return c.json(
      { query_id: body.query_id, hash: issued.hash },
      issued.created ? 201 : 200,
    );
  });

  app.get("/hash/:queryId", authMiddleware, (c) => {
    const queryId = c.req.param("queryId");
    const hash = queryHashMap.get(queryId);
    if (!hash) return c.json({ error: "No hash found for this query" }, 404);
    return c.json({ query_id: queryId, hash });
  });

  app.post("/verify", authMiddleware, async (c) => {
    const body = await c.req.json<
      { query: Query; result: QueryResult }
    >();
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
}
