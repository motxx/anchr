import type { Hono, MiddlewareHandler } from "hono";
import type { FrostCoordinator } from "@anchr/sdk/payments";
import type { ThresholdOracleConfig } from "@anchr/sdk/payments";

export interface FrostSignRouteDeps {
  authMiddleware: MiddlewareHandler;
  frostCoordinator: FrostCoordinator;
  /** Threshold config — signing is disabled (503) when undefined. */
  frostConfig?: ThresholdOracleConfig;
}

/**
 * Register the coordinator-side signing-session routes:
 *   POST /frost/sign/:queryId                  — start a session
 *   POST /frost/sign/:queryId/commitments      — submit a nonce commitment
 *   POST /frost/sign/:queryId/shares           — submit a signature share (auto-aggregates at threshold)
 *   GET  /frost/sign/:queryId                  — read session state
 */
export function registerFrostSignRoutes(
  app: Hono,
  deps: FrostSignRouteDeps,
): void {
  const { authMiddleware, frostCoordinator } = deps;

  app.post("/frost/sign/:queryId", authMiddleware, async (c) => {
    const queryId = c.req.param("queryId");
    const body = await c.req.json<{ message: string }>().catch(() => null);
    if (!body?.message) return c.json({ error: "Missing message" }, 400);
    if (!deps.frostConfig) {
      return c.json({ error: "FROST not configured" }, 503);
    }

    const session = frostCoordinator.startSigning(
      queryId,
      body.message,
      deps.frostConfig,
    );
    return c.json({
      session_id: session.session_id,
      query_id: session.query_id,
      message: session.message,
      threshold: session.config.threshold,
    }, 201);
  });

  app.post("/frost/sign/:queryId/commitments", authMiddleware, async (c) => {
    const body = await c.req.json<
      { session_id: string; signer_pubkey: string; commitment: string }
    >().catch(() => null);
    if (!body?.session_id || !body?.signer_pubkey || !body?.commitment) {
      return c.json({
        error: "Missing session_id, signer_pubkey, or commitment",
      }, 400);
    }

    frostCoordinator.submitNonceCommitment(
      body.session_id,
      body.signer_pubkey,
      body.commitment,
    );
    const session = frostCoordinator.getSigningSession(body.session_id);
    return c.json({
      commitments_count: session?.nonce_commitments.size ?? 0,
      threshold: session?.config.threshold ?? 0,
    });
  });

  app.post("/frost/sign/:queryId/shares", authMiddleware, async (c) => {
    const body = await c.req.json<
      { session_id: string; signer_pubkey: string; share: string }
    >().catch(() => null);
    if (!body?.session_id || !body?.signer_pubkey || !body?.share) {
      return c.json(
        { error: "Missing session_id, signer_pubkey, or share" },
        400,
      );
    }

    frostCoordinator.submitSignatureShare(
      body.session_id,
      body.signer_pubkey,
      body.share,
    );
    const session = frostCoordinator.getSigningSession(body.session_id);

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

  app.get("/frost/sign/:queryId", authMiddleware, (c) => {
    const queryId = c.req.param("queryId");
    const found = frostCoordinator.getSigningSession(queryId);
    if (!found) return c.json({ error: "Signing session not found" }, 404);
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
}
