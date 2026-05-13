import { Hono } from "hono";
import { z } from "zod";
import { isTlsnVerifierAvailable } from "@anchr/tlsn-toolkit/tlsn-validation";
import {
  ProofGateError,
  type ProofGateService,
} from "@anchr/bounty/claim-gate";
import type { ProofCondition } from "./airdrop-criteria.ts";

const ConditionSchema = z.object({
  type: z.enum([
    "github_account_age",
    "twitter_followers",
    "github_repos",
    "github_contributions",
  ]),
  target_url: z.string().min(1),
  min_value: z.number().int().positive().optional(),
  jsonpath: z.string().min(1),
  description: z.string().min(1),
});

const CreateCampaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  conditions: z.array(ConditionSchema).min(1),
  token_amount_per_claim: z.number().int().positive(),
  total_budget_sats: z.number().int().positive(),
  escrow_token: z.string().optional(),
  status: z.enum(["draft", "live", "paused", "closed"]).optional(),
  mint_url: z.string().url().optional(),
  public_base_url: z.string().url().optional(),
});

const SubmitClaimSchema = z.object({
  claim_id: z.string().uuid().optional(),
  claimant_pubkey: z.string().min(64),
  proofs: z.array(z.object({
    condition_index: z.number().int().nonnegative(),
    presentation: z.string().min(1),
  })).min(1),
});

export interface AirdropBotShieldRouteOptions {
  service: ProofGateService<ProofCondition>;
  adminToken?: string;
  productionReady?: boolean;
}

export function buildAirdropBotShieldApp(
  opts: AirdropBotShieldRouteOptions,
): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "airdrop-bot-shield",
      tlsn_verifier_available: isTlsnVerifierAvailable(),
    }));

  app.get("/ready", (c) =>
    c.json({
      ok: opts.productionReady ?? false,
      tlsn_verifier_available: isTlsnVerifierAvailable(),
    }, opts.productionReady ? 200 : 503));

  app.get("/airdrop/:id/status", async (c) => {
    try {
      return c.json(await opts.service.status(c.req.param("id")));
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/airdrop/create", async (c) => {
    if (!authorized(c.req.header("authorization"), opts.adminToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    try {
      const parsed = CreateCampaignSchema.parse(await c.req.json());
      const campaign = await opts.service.createCampaign(parsed);
      return c.json(campaign, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/airdrop/:id/reserve", async (c) => {
    try {
      const body = z.object({ claimant_pubkey: z.string().min(64) }).parse(
        await c.req.json(),
      );
      const claim = await opts.service.reserveClaim(
        c.req.param("id"),
        body.claimant_pubkey,
      );
      return c.json({
        claim_id: claim.id,
        htlc_hash: claim.htlc_hash,
        status: claim.status,
        settlement: claim.settlement,
      }, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/airdrop/:id/claim", async (c) => {
    try {
      const parsed = SubmitClaimSchema.parse(await c.req.json());
      const result = await opts.service.submitClaim(c.req.param("id"), parsed);
      return c.json(result, result.status === "approved" ? 200 : 422);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  return app;
}

function authorized(
  header: string | undefined,
  token: string | undefined,
): boolean {
  if (!token) return false;
  return header === `Bearer ${token}`;
}

function errorResponse(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
): Response {
  if (err instanceof ProofGateError) {
    return c.json({ error: err.code, message: err.message }, err.status);
  }
  if (err instanceof z.ZodError) {
    return c.json({ error: "invalid_request", issues: err.issues }, 400);
  }
  return c.json({
    error: "internal_error",
    message: err instanceof Error ? err.message : String(err),
  }, 500);
}
