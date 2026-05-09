import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { TlsnRequirement } from "@anchr/tlsn-toolkit/tlsn-types";
import type { TlsnValidationResult } from "@anchr/tlsn-toolkit/tlsn-validation";
import { createProofGateService } from "./service.ts";
import type { ProofGateSettlementProvider } from "./settlement.ts";
import type {
  ProofGateCampaign,
  ProofGateClaim,
  ProofGateCondition,
  ProofGateStore,
} from "./types.ts";

function fakeValidator(body: unknown) {
  return async (
    _attestation: { presentation: string },
    req: TlsnRequirement,
  ): Promise<TlsnValidationResult> => ({
    available: true,
    signatureValid: true,
    serverIdentityValid: true,
    attestationFresh: true,
    conditionResults: (req.conditions ?? []).map((condition) => ({
      condition,
      passed: true,
      actual_value: "ok",
    })),
    verifiedData: {
      server_name: req.domain_hint ?? "api.github.com",
      revealed_body: JSON.stringify(body),
      session_timestamp: Math.floor(Date.now() / 1000),
    },
    checks: ["ok"],
    failures: [],
  });
}

const conditions: ProofGateCondition[] = [
  {
    type: "account_age_days",
    target_url: "https://api.github.com/users/{username}",
    jsonpath: "created_at",
    min_value: 30,
    description: "account age",
  },
  {
    type: "github_repos",
    target_url: "https://api.github.com/users/{username}",
    jsonpath: "public_repos",
    min_value: 2,
    description: "repo count",
  },
];

function createMemoryStore(): ProofGateStore {
  const campaigns = new Map<string, ProofGateCampaign>();
  const claims = new Map<string, ProofGateClaim>();
  const presentationHashes = new Set<string>();

  return {
    upsertCampaign(campaign) {
      campaigns.set(campaign.id, structuredClone(campaign));
      return Promise.resolve();
    },
    getCampaign(id) {
      const campaign = campaigns.get(id);
      return Promise.resolve(campaign ? structuredClone(campaign) : undefined);
    },
    listCampaigns() {
      return Promise.resolve(
        Array.from(campaigns.values()).map((campaign) =>
          structuredClone(campaign)
        ),
      );
    },
    createClaim(claim) {
      claims.set(claim.id, structuredClone(claim));
      return Promise.resolve();
    },
    getClaim(id) {
      const claim = claims.get(id);
      return Promise.resolve(claim ? structuredClone(claim) : undefined);
    },
    updateClaim(claim) {
      claims.set(claim.id, structuredClone(claim));
      return Promise.resolve();
    },
    approvedClaimCount(campaignId) {
      let count = 0;
      for (const claim of claims.values()) {
        if (claim.campaign_id === campaignId && claim.status === "approved") {
          count++;
        }
      }
      return Promise.resolve(count);
    },
    findApprovedByNullifier(campaignId, nullifierHash) {
      for (const claim of claims.values()) {
        if (
          claim.campaign_id === campaignId &&
          claim.status === "approved" &&
          claim.nullifier_hash === nullifierHash
        ) {
          return Promise.resolve(structuredClone(claim));
        }
      }
      return Promise.resolve(undefined);
    },
    reservePresentationHashes(_campaignId, _claimId, hashes) {
      if (hashes.some((hash) => presentationHashes.has(hash))) {
        return Promise.resolve(false);
      }
      for (const hash of hashes) presentationHashes.add(hash);
      return Promise.resolve(true);
    },
    close() {
      return Promise.resolve();
    },
  };
}

describe("proof-gate service", () => {
  it("approves once and rejects duplicate account nullifier", async () => {
    const store = createMemoryStore();
    const service = createProofGateService({
      store,
      nullifierSecret: "x".repeat(32),
      identityPathForCondition: (condition) =>
        condition.type.startsWith("github") ||
          condition.type === "account_age_days"
          ? "id"
          : undefined,
      validateTlsnFn: fakeValidator({
        id: 123,
        created_at: "2020-01-01T00:00:00Z",
        public_repos: 4,
      }),
    });

    await service.createCampaign({
      id: "gate",
      name: "Gate",
      conditions,
      token_amount_per_claim: 1000,
      total_budget_sats: 2000,
    });

    const first = await service.submitClaim("gate", {
      claimant_pubkey: "02" + "11".repeat(32),
      proofs: [
        { condition_index: 0, presentation: "a" },
        { condition_index: 1, presentation: "b" },
      ],
    });
    expect(first.status).toBe("approved");
    expect(first.preimage).toMatch(/^[0-9a-f]{64}$/);

    await expect(service.submitClaim("gate", {
      claimant_pubkey: "02" + "22".repeat(32),
      proofs: [
        { condition_index: 0, presentation: "c" },
        { condition_index: 1, presentation: "d" },
      ],
    })).rejects.toThrow("already claimed");
    await store.close();
  });

  it("uses an injected settlement provider for lock and release", async () => {
    const store = createMemoryStore();
    let reservedHash = "";
    const settlementProvider: ProofGateSettlementProvider = {
      reserveClaimSettlement(params) {
        reservedHash = params.htlcHash;
        return Promise.resolve({
          type: "cashu_htlc",
          status: "locked",
          htlc_hash: params.htlcHash,
          amount_sats: params.amountSats,
          claimant_pubkey: params.claimantPubkey,
          cashu_token: "cashuB-locked",
          locktime_seconds: 1_800_000_000,
        });
      },
      releaseClaimSettlement(params) {
        return Promise.resolve({
          ...params.claim.settlement!,
          status: "released",
        });
      },
    };
    const service = createProofGateService({
      store,
      settlementProvider,
      nullifierSecret: "x".repeat(32),
      identityPathForCondition: (condition) =>
        condition.type.startsWith("github") ||
          condition.type === "account_age_days"
          ? "id"
          : undefined,
      validateTlsnFn: fakeValidator({
        id: 987,
        created_at: "2020-01-01T00:00:00Z",
        public_repos: 4,
      }),
    });

    await service.createCampaign({
      id: "settled",
      name: "Settled",
      conditions,
      token_amount_per_claim: 1000,
      total_budget_sats: 1000,
    });
    const reserved = await service.reserveClaim(
      "settled",
      "02" + "33".repeat(32),
    );
    expect(reserved.settlement?.cashu_token).toBe("cashuB-locked");
    expect(reserved.settlement?.htlc_hash).toBe(reservedHash);

    const result = await service.submitClaim("settled", {
      claim_id: reserved.id,
      claimant_pubkey: "02" + "33".repeat(32),
      proofs: [
        { condition_index: 0, presentation: "e" },
        { condition_index: 1, presentation: "f" },
      ],
    });
    expect(result.status).toBe("approved");
    expect(result.settlement?.status).toBe("released");
    expect(result.settlement?.cashu_token).toBe("cashuB-locked");
    await store.close();
  });
});
