import type { Hono, MiddlewareHandler } from "hono";
import { verifyProof } from "../verification/verifier.ts";
import { signRound1, signRound2 } from "@anchr/sdk/payments";
import type { FrostNodeConfig } from "@anchr/sdk/payments";
import type {
  BlossomKeyMap,
  VerificationInput,
  VerificationRequirement,
} from "../../domain/types.ts";

export interface FrostSignerRouteDeps {
  authMiddleware: MiddlewareHandler;
  /** Per-node FROST key package — signing is disabled (503) when undefined. */
  frostNodeConfig?: FrostNodeConfig;
  /** Pending signing nonces, keyed by random session id. */
  pendingNonces: Map<string, string>;
}

/**
 * Register the per-node peer signing protocol:
 *   POST /frost/signer/round1 — independent verify + commit nonces
 *   POST /frost/signer/round2 — produce signature share
 *
 * Each peer Oracle node verifies the requirement / input pair independently
 * before committing nonces. If verification fails the node refuses to sign —
 * the coordinator cannot reach threshold without enough honest peers.
 *
 * The body is a `VerificationRequirement` + `VerificationInput`, *not* a
 * NIP-90 `Query` envelope, so this route is reachable equally from the
 * NIP-90 host and from a fixed-stakeholder caller that constructed the
 * requirement directly.
 */
export function registerFrostSignerRoutes(
  app: Hono,
  deps: FrostSignerRouteDeps,
): void {
  const { authMiddleware, pendingNonces } = deps;

  app.post("/frost/signer/round1", authMiddleware, async (c) => {
    const body = await c.req.json<{
      message: string;
      requirement: VerificationRequirement;
      input: VerificationInput;
      blossom_keys?: BlossomKeyMap;
    }>().catch(() => null);
    if (!body?.message || !body?.requirement || !body?.input) {
      return c.json({ error: "Missing message, requirement, or input" }, 400);
    }
    if (!deps.frostNodeConfig) {
      return c.json({ error: "FROST not configured on this node" }, 503);
    }

    // Mandatory independent verification — without this check a malicious
    // coordinator could produce group signatures for arbitrary garbage.
    const detail = await verifyProof(body.requirement, body.input, {
      blossomKeys: body.blossom_keys,
    });
    if (!detail.passed) {
      return c.json(
        { error: "Verification failed", failures: detail.failures },
        403,
      );
    }

    const keyPackageJson = JSON.stringify(deps.frostNodeConfig.key_package);
    const result = await signRound1(keyPackageJson);
    if (!result.ok) return c.json({ error: result.error }, 500);

    // Nonce reuse in Schnorr leaks the signer's secret share. Key by a
    // random session id — never by message content — to keep round 2's
    // input independent of round 1's authenticated body.
    const nonceId = crypto.randomUUID();
    pendingNonces.set(nonceId, JSON.stringify(result.data!.nonces));

    return c.json({ commitments: result.data!.commitments, nonce_id: nonceId });
  });

  app.post("/frost/signer/round2", authMiddleware, async (c) => {
    const body = await c.req.json<
      { commitments: string; message: string; nonce_id: string }
    >().catch(() => null);
    if (!body?.commitments || !body?.message || !body?.nonce_id) {
      return c.json(
        { error: "Missing commitments, message, or nonce_id" },
        400,
      );
    }
    if (!deps.frostNodeConfig) {
      return c.json({ error: "FROST not configured on this node" }, 503);
    }

    const nonces = pendingNonces.get(body.nonce_id);
    if (!nonces) return c.json({ error: "Unknown or expired nonce_id" }, 409);
    pendingNonces.delete(body.nonce_id); // single-use — consume on read

    const keyPackageJson = JSON.stringify(deps.frostNodeConfig.key_package);
    const result = await signRound2(
      keyPackageJson,
      nonces,
      body.commitments,
      body.message,
    );

    if (!result.ok) return c.json({ error: result.error }, 500);
    return c.json({ signature_share: result.data!.signature_share });
  });
}
