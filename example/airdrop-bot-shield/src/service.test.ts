import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { TlsnValidationResult } from "@anchr/tlsn-toolkit/tlsn-validation";
import type { TlsnRequirement } from "@anchr/tlsn-toolkit/tlsn-types";
import { createProofGateService, openSqliteProofGateStore } from "@anchr/bounty/claim-gate";
import { buildAirdropBotShieldApp } from "./server-routes.ts";
import { identityPathForAirdropCondition } from "./identity-policy.ts";
import {
  buildGitHubAgeCondition,
  buildGitHubReposCondition,
  type AirdropCriteria,
  type ProofCondition,
} from "./airdrop-criteria.ts";

function campaign(): AirdropCriteria {
  return {
    id: "airdrop-bot-shield-test",
    name: "Airdrop Bot Shield Test",
    conditions: [buildGitHubAgeCondition(30), buildGitHubReposCondition(2)],
    token_amount_per_claim: 1000,
    total_budget_sats: 2000,
  };
}

function fakeValidator(body: unknown) {
  return async (_attestation: { presentation: string }, req: TlsnRequirement): Promise<TlsnValidationResult> => ({
    available: true,
    signatureValid: true,
    serverIdentityValid: true,
    attestationFresh: true,
    conditionResults: (req.conditions ?? []).map((condition) => ({ condition, passed: true, actual_value: "ok" })),
    verifiedData: {
      server_name: req.domain_hint ?? "api.github.com",
      revealed_body: JSON.stringify(body),
      session_timestamp: Math.floor(Date.now() / 1000),
    },
    checks: ["ok"],
    failures: [],
  });
}

describe("ProofGateService for airdrop bot shield", () => {
  it("approves a TLSN-verified GitHub claim and releases only the preimage", async () => {
    const store = openSqliteProofGateStore<ProofCondition>(":memory:");
    const service = createProofGateService<ProofCondition>({
      store,
      nullifierSecret: "x".repeat(32),
      identityPathForCondition: identityPathForAirdropCondition,
      accountAgeConditionTypes: new Set(["github_account_age"]),
      validateTlsnFn: fakeValidator({
        id: 123,
        created_at: "2025-01-01T00:00:00Z",
        public_repos: 4,
      }),
    });
    await service.createCampaign(campaign());

    const result = await service.submitClaim("airdrop-bot-shield-test", {
      claimant_pubkey: "02" + "11".repeat(32),
      proofs: [
        { condition_index: 0, presentation: "proof-a" },
        { condition_index: 1, presentation: "proof-b" },
      ],
    });

    expect(result.status).toBe("approved");
    expect(result.preimage).toMatch(/^[0-9a-f]{64}$/);
    expect(result.htlc_hash).toMatch(/^[0-9a-f]{64}$/);
    await store.close();
  });

  it("rejects a second approved claim for the same verified account", async () => {
    const store = openSqliteProofGateStore<ProofCondition>(":memory:");
    const service = createProofGateService<ProofCondition>({
      store,
      nullifierSecret: "x".repeat(32),
      identityPathForCondition: identityPathForAirdropCondition,
      accountAgeConditionTypes: new Set(["github_account_age"]),
      validateTlsnFn: fakeValidator({
        id: 456,
        created_at: "2020-01-01T00:00:00Z",
        public_repos: 10,
      }),
    });
    await service.createCampaign(campaign());

    await service.submitClaim("airdrop-bot-shield-test", {
      claimant_pubkey: "02" + "22".repeat(32),
      proofs: [
        { condition_index: 0, presentation: "proof-c" },
        { condition_index: 1, presentation: "proof-d" },
      ],
    });

    await expect(service.submitClaim("airdrop-bot-shield-test", {
      claimant_pubkey: "02" + "33".repeat(32),
      proofs: [
        { condition_index: 0, presentation: "proof-e" },
        { condition_index: 1, presentation: "proof-f" },
      ],
    })).rejects.toThrow("already claimed");
    await store.close();
  });

  it("can approve a claim against a pre-reserved HTLC hash", async () => {
    const store = openSqliteProofGateStore<ProofCondition>(":memory:");
    const service = createProofGateService<ProofCondition>({
      store,
      nullifierSecret: "x".repeat(32),
      identityPathForCondition: identityPathForAirdropCondition,
      accountAgeConditionTypes: new Set(["github_account_age"]),
      validateTlsnFn: fakeValidator({
        id: 789,
        created_at: "2020-01-01T00:00:00Z",
        public_repos: 10,
      }),
    });
    await service.createCampaign(campaign());

    const claimant_pubkey = "02" + "44".repeat(32);
    const reserved = await service.reserveClaim("airdrop-bot-shield-test", claimant_pubkey);
    const result = await service.submitClaim("airdrop-bot-shield-test", {
      claim_id: reserved.id,
      claimant_pubkey,
      proofs: [
        { condition_index: 0, presentation: "proof-g" },
        { condition_index: 1, presentation: "proof-h" },
      ],
    });

    expect(result.status).toBe("approved");
    expect(result.claim_id).toBe(reserved.id);
    expect(result.htlc_hash).toBe(reserved.htlc_hash);
    await store.close();
  });
});

describe("airdrop bot shield routes", () => {
  it("requires admin auth to create campaigns and exposes status", async () => {
    const store = openSqliteProofGateStore<ProofCondition>(":memory:");
    const service = createProofGateService<ProofCondition>({
      store,
      nullifierSecret: "x".repeat(32),
      identityPathForCondition: identityPathForAirdropCondition,
      accountAgeConditionTypes: new Set(["github_account_age"]),
      validateTlsnFn: fakeValidator({ id: 1, created_at: "2020-01-01T00:00:00Z", public_repos: 3 }),
    });
    const app = buildAirdropBotShieldApp({ service, adminToken: "secret".repeat(8), productionReady: true });

    const denied = await app.request("/airdrop/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(campaign()),
    });
    expect(denied.status).toBe(401);

    const created = await app.request("/airdrop/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${"secret".repeat(8)}`,
      },
      body: JSON.stringify(campaign()),
    });
    expect(created.status).toBe(201);

    const status = await app.request("/airdrop/airdrop-bot-shield-test/status");
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body.remaining_claims).toBe(2);
    await store.close();
  });
});
