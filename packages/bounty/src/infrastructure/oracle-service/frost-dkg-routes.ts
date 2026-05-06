import type { Hono, MiddlewareHandler } from "hono";
import type { FrostCoordinator } from "@anchr/frost-oracle/coordinator";

export interface FrostDkgRouteDeps {
  authMiddleware: MiddlewareHandler;
  frostCoordinator: FrostCoordinator;
}

/**
 * Register Distributed Key Generation routes:
 *   POST /frost/dkg/init                    — create a new DKG session
 *   POST /frost/dkg/:sessionId/round/:n     — submit DKG round package (n ∈ {1,2,3})
 *   GET  /frost/dkg/:sessionId              — read DKG session state
 */
export function registerFrostDkgRoutes(app: Hono, deps: FrostDkgRouteDeps): void {
  const { authMiddleware, frostCoordinator } = deps;

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
      sessionId, round, body.signer_index, body.package, body.secret_package,
    );
    if (!result) return c.json({ error: "DKG session not found" }, 404);
    return c.json(result);
  });

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
}
