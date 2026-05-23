import { createHash, createHmac, randomUUID } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { type TlsnValidationResult, validateTlsn } from "@anchr/sdk/proofs";
import type { TlsnAttestation, TlsnRequirement } from "@anchr/sdk/proofs";
import type {
  ClaimProof,
  ClaimVerificationResult,
  ConditionResult,
  ProofGateCampaign,
  ProofGateClaim,
  ProofGateCondition,
  ProofGateSettlement,
  ProofGateStore,
  VerifiedProofData,
} from "./types.ts";
import type { ProofGateSettlementProvider } from "./settlement.ts";

const BLOCKED_PROPS = new Set(["__proto__", "constructor", "prototype"]);

export interface CreateProofGateCampaignInput<
  C extends ProofGateCondition = ProofGateCondition,
> {
  id: string;
  name: string;
  conditions: C[];
  token_amount_per_claim: number;
  total_budget_sats: number;
  escrow_token?: string;
  status?: "draft" | "live" | "paused" | "closed";
  mint_url?: string;
  public_base_url?: string;
}

export interface SubmitProofGateClaimInput {
  claim_id?: string;
  claimant_pubkey: string;
  proofs: ClaimProof[];
}

export type ValidateTlsnFn = (
  attestation: TlsnAttestation,
  requirement: TlsnRequirement,
) => Promise<TlsnValidationResult>;

export interface ProofGateServiceOptions<
  C extends ProofGateCondition = ProofGateCondition,
> {
  store: ProofGateStore<C>;
  nullifierSecret: string;
  identityPathForCondition: (condition: C) => string | undefined;
  validateTlsnFn?: ValidateTlsnFn;
  conditionEvaluator?: (
    condition: C,
    verifiedData: VerifiedProofData,
  ) => ConditionResult<C>;
  settlementProvider?: ProofGateSettlementProvider<C>;
  accountAgeConditionTypes?: ReadonlySet<string>;
  maxAttestationAgeSeconds?: number;
}

export interface SubmitProofGateClaimResult<
  C extends ProofGateCondition = ProofGateCondition,
> extends ClaimVerificationResult<C> {
  claim_id: string;
  htlc_hash: string;
  status: "approved" | "rejected";
  nullifier_hash?: string;
}

export interface ProofGateCampaignStatus<
  C extends ProofGateCondition = ProofGateCondition,
> {
  id: string;
  name: string;
  status: ProofGateCampaign<C>["status"];
  token_amount_per_claim: number;
  total_budget_sats: number;
  max_claims: number;
  approved_claims: number;
  remaining_claims: number;
  mint_url?: string;
  conditions: C[];
}

export class ProofGateError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export class ProofGateService<
  C extends ProofGateCondition = ProofGateCondition,
> {
  readonly #store: ProofGateStore<C>;
  readonly #nullifierSecret: string;
  readonly #identityPathForCondition: (condition: C) => string | undefined;
  readonly #validateTlsn: ValidateTlsnFn;
  readonly #evaluateCondition: (
    condition: C,
    verifiedData: VerifiedProofData,
  ) => ConditionResult<C>;
  readonly #settlementProvider?: ProofGateSettlementProvider<C>;
  readonly #maxAttestationAgeSeconds: number;

  constructor(opts: ProofGateServiceOptions<C>) {
    this.#store = opts.store;
    this.#nullifierSecret = opts.nullifierSecret;
    this.#identityPathForCondition = opts.identityPathForCondition;
    this.#validateTlsn = opts.validateTlsnFn ?? validateTlsn;
    this.#evaluateCondition = opts.conditionEvaluator ??
      ((condition, data) =>
        evaluateProofGateCondition(
          condition,
          data,
          opts.accountAgeConditionTypes,
        ));
    this.#settlementProvider = opts.settlementProvider;
    this.#maxAttestationAgeSeconds = opts.maxAttestationAgeSeconds ?? 600;
  }

  async createCampaign(
    input: CreateProofGateCampaignInput<C>,
  ): Promise<ProofGateCampaign<C>> {
    const errors = validateProofGateCampaign(input);
    if (errors.length > 0) {
      throw new ProofGateError(400, "invalid_campaign", errors.join("; "));
    }
    if (!input.conditions.some((c) => this.#identityPathForCondition(c))) {
      throw new ProofGateError(
        400,
        "missing_identity_condition",
        "At least one condition must expose a stable account identity path",
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const campaign: ProofGateCampaign<C> = {
      ...input,
      status: input.status ?? "live",
      created_at: now,
      updated_at: now,
    };
    await this.#store.upsertCampaign(campaign);
    return campaign;
  }

  async reserveClaim(
    campaignId: string,
    claimantPubkey: string,
  ): Promise<ProofGateClaim<C>> {
    const campaign = await this.#requireLiveCampaign(campaignId);
    await this.#ensureBudgetAvailable(campaign);
    if (!isHexPubkey(claimantPubkey)) {
      throw new ProofGateError(
        400,
        "invalid_claimant_pubkey",
        "claimant_pubkey must be a 32-byte or compressed secp256k1 hex public key",
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const { preimage, hash } = generateProofGateClaimHash();
    const claim: ProofGateClaim<C> = {
      id: randomUUID(),
      campaign_id: campaign.id,
      claimant_pubkey: claimantPubkey,
      htlc_hash: hash,
      preimage,
      status: "reserved",
      created_at: now,
      updated_at: now,
    };
    claim.settlement = await this.#reserveSettlement(campaign, claim);
    if (claim.settlement.status === "failed") {
      throw new ProofGateError(
        502,
        "settlement_reserve_failed",
        claim.settlement.error ?? "Failed to reserve claim settlement",
      );
    }
    await this.#store.createClaim(claim);
    return { ...claim, preimage: "" };
  }

  async submitClaim(
    campaignId: string,
    input: SubmitProofGateClaimInput,
  ): Promise<SubmitProofGateClaimResult<C>> {
    const campaign = await this.#requireLiveCampaign(campaignId);
    await this.#ensureBudgetAvailable(campaign);
    if (!isHexPubkey(input.claimant_pubkey)) {
      throw new ProofGateError(
        400,
        "invalid_claimant_pubkey",
        "claimant_pubkey must be a 32-byte or compressed secp256k1 hex public key",
      );
    }
    if (input.proofs.length !== campaign.conditions.length) {
      throw new ProofGateError(
        400,
        "proof_count_mismatch",
        `Expected ${campaign.conditions.length} proofs, got ${input.proofs.length}`,
      );
    }

    const hashes = input.proofs.map((p) => presentationHash(p.presentation));
    const claim = await this.#getOrCreateReservedClaim(campaign.id, input);
    const preimage = claim.preimage;

    const replayOk = await this.#store.reservePresentationHashes(
      campaign.id,
      claim.id,
      hashes,
    );
    if (!replayOk) {
      await this.#rejectClaim(
        campaign,
        claim,
        "TLSNotary presentation already used",
      );
      throw new ProofGateError(
        409,
        "presentation_replay",
        "One or more TLSNotary presentations were already submitted",
      );
    }

    let verifiedProofs: Map<number, VerifiedProofData>;
    try {
      verifiedProofs = await this.#verifyPresentations(campaign, input.proofs);
    } catch (err) {
      await this.#rejectClaim(
        campaign,
        claim,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }

    const nullifierHash = deriveNullifier(
      campaign,
      verifiedProofs,
      this.#nullifierSecret,
      this.#identityPathForCondition,
    );
    if (!nullifierHash) {
      const reason =
        "No stable account identity could be extracted from verified proof data";
      await this.#rejectClaim(campaign, claim, reason);
      throw new ProofGateError(400, "missing_nullifier", reason);
    }
    const duplicate = await this.#store.findApprovedByNullifier(
      campaign.id,
      nullifierHash,
    );
    if (duplicate) {
      claim.nullifier_hash = nullifierHash;
      const reason = "This account has already claimed this campaign";
      await this.#rejectClaim(campaign, claim, reason);
      throw new ProofGateError(409, "duplicate_account", reason);
    }

    const result = verifyProofGateClaim(
      campaign,
      verifiedProofs,
      preimage,
      this.#evaluateCondition,
    );
    claim.status = result.all_passed ? "approved" : "rejected";
    claim.nullifier_hash = nullifierHash;
    claim.results = result.results;
    claim.failures = result.failures;
    if (result.all_passed) {
      claim.settlement = await this.#releaseSettlement(
        campaign,
        claim,
        preimage,
      );
      result.settlement = claim.settlement;
    } else {
      await this.#rejectSettlement(
        campaign,
        claim,
        result.failures.join("; ") || "claim verification failed",
      );
    }
    claim.updated_at = Math.floor(Date.now() / 1000);
    await this.#store.updateClaim(claim);

    return {
      ...result,
      claim_id: claim.id,
      htlc_hash: claim.htlc_hash,
      status: claim.status,
      nullifier_hash: nullifierHash,
      settlement: claim.settlement,
    };
  }

  async status(campaignId: string): Promise<ProofGateCampaignStatus<C>> {
    const campaign = await this.#store.getCampaign(campaignId);
    if (!campaign) {
      throw new ProofGateError(404, "campaign_not_found", "Campaign not found");
    }
    const approved_claims = await this.#store.approvedClaimCount(campaign.id);
    const max_claims = maxProofGateClaims(campaign);
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      token_amount_per_claim: campaign.token_amount_per_claim,
      total_budget_sats: campaign.total_budget_sats,
      max_claims,
      approved_claims,
      remaining_claims: Math.max(0, max_claims - approved_claims),
      mint_url: campaign.mint_url,
      conditions: campaign.conditions,
    };
  }

  async #requireLiveCampaign(
    campaignId: string,
  ): Promise<ProofGateCampaign<C>> {
    const campaign = await this.#store.getCampaign(campaignId);
    if (!campaign) {
      throw new ProofGateError(404, "campaign_not_found", "Campaign not found");
    }
    if (campaign.status !== "live") {
      throw new ProofGateError(
        409,
        "campaign_not_live",
        `Campaign is ${campaign.status}`,
      );
    }
    return campaign;
  }

  async #ensureBudgetAvailable(campaign: ProofGateCampaign<C>): Promise<void> {
    const approved = await this.#store.approvedClaimCount(campaign.id);
    if (approved >= maxProofGateClaims(campaign)) {
      throw new ProofGateError(
        409,
        "budget_exhausted",
        "Campaign budget is exhausted",
      );
    }
  }

  async #getOrCreateReservedClaim(
    campaignId: string,
    input: SubmitProofGateClaimInput,
  ): Promise<ProofGateClaim<C>> {
    if (input.claim_id) {
      const claim = await this.#store.getClaim(input.claim_id);
      if (!claim || claim.campaign_id !== campaignId) {
        throw new ProofGateError(
          404,
          "claim_not_found",
          "Reserved claim not found",
        );
      }
      if (claim.status !== "reserved") {
        throw new ProofGateError(
          409,
          "claim_not_reserved",
          `Claim is ${claim.status}`,
        );
      }
      if (
        claim.claimant_pubkey.toLowerCase() !==
          input.claimant_pubkey.toLowerCase()
      ) {
        throw new ProofGateError(
          409,
          "claimant_pubkey_mismatch",
          "Reserved claim belongs to a different claimant_pubkey",
        );
      }
      return claim;
    }

    const { preimage, hash } = generateProofGateClaimHash();
    const now = Math.floor(Date.now() / 1000);
    const claim: ProofGateClaim<C> = {
      id: randomUUID(),
      campaign_id: campaignId,
      claimant_pubkey: input.claimant_pubkey,
      htlc_hash: hash,
      preimage,
      status: "reserved",
      created_at: now,
      updated_at: now,
    };
    const campaign = await this.#store.getCampaign(campaignId);
    if (!campaign) {
      throw new ProofGateError(404, "campaign_not_found", "Campaign not found");
    }
    claim.settlement = await this.#reserveSettlement(campaign, claim);
    if (claim.settlement.status === "failed") {
      throw new ProofGateError(
        502,
        "settlement_reserve_failed",
        claim.settlement.error ?? "Failed to reserve claim settlement",
      );
    }
    await this.#store.createClaim(claim);
    return claim;
  }

  async #reserveSettlement(
    campaign: ProofGateCampaign<C>,
    claim: ProofGateClaim<C>,
  ): Promise<ProofGateSettlement> {
    if (!this.#settlementProvider) {
      return {
        type: "preimage_only",
        status: "reserved",
        htlc_hash: claim.htlc_hash,
        amount_sats: campaign.token_amount_per_claim,
        claimant_pubkey: claim.claimant_pubkey,
      };
    }
    return this.#settlementProvider.reserveClaimSettlement({
      campaign,
      claimId: claim.id,
      claimantPubkey: claim.claimant_pubkey,
      htlcHash: claim.htlc_hash,
      amountSats: campaign.token_amount_per_claim,
    });
  }

  async #releaseSettlement(
    campaign: ProofGateCampaign<C>,
    claim: ProofGateClaim<C>,
    preimage: string,
  ): Promise<ProofGateSettlement> {
    if (!this.#settlementProvider) {
      return {
        ...(claim.settlement ?? {
          type: "preimage_only",
          htlc_hash: claim.htlc_hash,
          amount_sats: campaign.token_amount_per_claim,
          claimant_pubkey: claim.claimant_pubkey,
        }),
        status: "released",
      };
    }
    return this.#settlementProvider.releaseClaimSettlement({
      campaign,
      claim,
      preimage,
    });
  }

  async #rejectClaim(
    campaign: ProofGateCampaign<C>,
    claim: ProofGateClaim<C>,
    reason: string,
  ): Promise<void> {
    claim.status = "rejected";
    claim.failures = [reason];
    await this.#rejectSettlement(campaign, claim, reason);
    claim.updated_at = Math.floor(Date.now() / 1000);
    await this.#store.updateClaim(claim);
  }

  async #rejectSettlement(
    campaign: ProofGateCampaign<C>,
    claim: ProofGateClaim<C>,
    reason: string,
  ): Promise<void> {
    await this.#settlementProvider?.rejectClaimSettlement?.({
      campaign,
      claim,
      reason,
    });
  }

  async #verifyPresentations(
    campaign: ProofGateCampaign<C>,
    proofs: ClaimProof[],
  ): Promise<Map<number, VerifiedProofData>> {
    const requirements = toProofGateTlsnRequirements(
      campaign.conditions,
      this.#maxAttestationAgeSeconds,
    );
    const verified = new Map<number, VerifiedProofData>();
    const seenIndexes = new Set<number>();

    for (const proof of proofs) {
      if (
        !Number.isInteger(proof.condition_index) || proof.condition_index < 0 ||
        proof.condition_index >= campaign.conditions.length
      ) {
        throw new ProofGateError(
          400,
          "invalid_condition_index",
          `Invalid condition_index ${proof.condition_index}`,
        );
      }
      if (seenIndexes.has(proof.condition_index)) {
        throw new ProofGateError(
          400,
          "duplicate_condition_index",
          `Duplicate condition_index ${proof.condition_index}`,
        );
      }
      seenIndexes.add(proof.condition_index);

      const result = await this.#validateTlsn({
        presentation: proof.presentation,
      }, requirements[proof.condition_index]!);
      const failed = !result.available || !result.signatureValid ||
        !result.serverIdentityValid || !result.attestationFresh ||
        result.conditionResults.some((r) => !r.passed) || !result.verifiedData;
      if (failed) {
        throw new ProofGateError(
          422,
          "tlsn_verification_failed",
          result.failures.join("; ") || "TLSNotary proof failed verification",
        );
      }
      verified.set(proof.condition_index, result.verifiedData!);
    }

    return verified;
  }
}

export function createProofGateService<C extends ProofGateCondition>(
  opts: ProofGateServiceOptions<C>,
): ProofGateService<C> {
  return new ProofGateService(opts);
}

export function generateProofGateClaimHash(): {
  preimage: string;
  hash: string;
} {
  const preimageBytes = new Uint8Array(32);
  crypto.getRandomValues(preimageBytes);
  const preimage = bytesToHex(preimageBytes);
  const hash = bytesToHex(sha256(preimageBytes));
  return { preimage, hash };
}

export function maxProofGateClaims(
  criteria: { token_amount_per_claim: number; total_budget_sats: number },
): number {
  if (criteria.token_amount_per_claim <= 0) return 0;
  return Math.floor(
    criteria.total_budget_sats / criteria.token_amount_per_claim,
  );
}

export function toProofGateTlsnRequirements(
  conditions: ProofGateCondition[],
  maxAttestationAgeSeconds = 600,
): TlsnRequirement[] {
  return conditions.map((cond) => {
    const hostname =
      new URL(cond.target_url.replace(/\{[^}]+\}/g, "placeholder")).hostname;
    return {
      target_url: cond.target_url,
      method: "GET",
      domain_hint: hostname,
      max_attestation_age_seconds: maxAttestationAgeSeconds,
      conditions: [
        {
          type: "jsonpath",
          expression: cond.jsonpath,
          description: cond.description,
        },
      ],
    };
  });
}

export function evaluateProofGateCondition<C extends ProofGateCondition>(
  condition: C,
  verifiedData: VerifiedProofData,
  accountAgeConditionTypes: ReadonlySet<string> = new Set(["account_age_days"]),
): ConditionResult<C> {
  const expectedHost = extractHostname(condition.target_url);
  if (!expectedHost) {
    return {
      condition,
      passed: false,
      reason: `Invalid target URL: ${condition.target_url}`,
    };
  }
  if (verifiedData.server_name !== expectedHost) {
    return {
      condition,
      passed: false,
      reason:
        `Domain mismatch: expected "${expectedHost}", got "${verifiedData.server_name}"`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(verifiedData.revealed_body);
  } catch {
    return {
      condition,
      passed: false,
      reason: "Response body is not valid JSON",
    };
  }

  const rawValue = resolveDotPath(parsed, condition.jsonpath);
  if (rawValue === undefined) {
    return {
      condition,
      passed: false,
      reason: `JSONPath "${condition.jsonpath}" not found in response`,
    };
  }

  let numericValue: number;
  if (accountAgeConditionTypes.has(condition.type)) {
    const createdAt = new Date(String(rawValue));
    if (Number.isNaN(createdAt.getTime())) {
      return {
        condition,
        passed: false,
        extracted_value: String(rawValue),
        reason:
          `Cannot parse "${rawValue}" as date for account age calculation`,
      };
    }
    numericValue = Math.floor(
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
  } else {
    numericValue = Number(rawValue);
    if (Number.isNaN(numericValue)) {
      return {
        condition,
        passed: false,
        extracted_value: String(rawValue),
        reason:
          `Expected numeric value at "${condition.jsonpath}", got "${rawValue}"`,
      };
    }
  }

  if (condition.min_value !== undefined && numericValue < condition.min_value) {
    return {
      condition,
      passed: false,
      extracted_value: numericValue,
      reason:
        `Value ${numericValue} is below minimum ${condition.min_value} (${condition.description})`,
    };
  }

  return {
    condition,
    passed: true,
    extracted_value: numericValue,
    reason: `Passed: ${condition.description} (value: ${numericValue})`,
  };
}

export function verifyProofGateClaim<C extends ProofGateCondition>(
  campaign: ProofGateCampaign<C>,
  verifiedProofs: Map<number, VerifiedProofData>,
  preimage: string,
  evaluateCondition: (
    condition: C,
    verifiedData: VerifiedProofData,
  ) => ConditionResult<C> = evaluateProofGateCondition,
): ClaimVerificationResult<C> {
  const results: Array<ConditionResult<C>> = [];
  const checks: string[] = [];
  const failures: string[] = [];

  for (let i = 0; i < campaign.conditions.length; i++) {
    const condition = campaign.conditions[i]!;
    const proofData = verifiedProofs.get(i);
    if (!proofData) {
      const result: ConditionResult<C> = {
        condition,
        passed: false,
        reason:
          `No proof submitted for condition ${i}: ${condition.description}`,
      };
      results.push(result);
      failures.push(result.reason);
      continue;
    }

    const result = evaluateCondition(condition, proofData);
    results.push(result);
    if (result.passed) checks.push(result.reason);
    else failures.push(result.reason);
  }

  const allPassed = results.every((r) => r.passed);
  return {
    all_passed: allPassed,
    results,
    preimage: allPassed ? preimage : undefined,
    checks,
    failures,
  };
}

export function deriveProofGateNullifier<C extends ProofGateCondition>(
  campaign: ProofGateCampaign<C>,
  verifiedProofs: Map<number, VerifiedProofData>,
  secret: string,
  identityPathForCondition: (condition: C) => string | undefined,
): string | undefined {
  return deriveNullifier(
    campaign,
    verifiedProofs,
    secret,
    identityPathForCondition,
  );
}

function deriveNullifier<C extends ProofGateCondition>(
  campaign: ProofGateCampaign<C>,
  verifiedProofs: Map<number, VerifiedProofData>,
  secret: string,
  identityPathForCondition: (condition: C) => string | undefined,
): string | undefined {
  for (let i = 0; i < campaign.conditions.length; i++) {
    const condition = campaign.conditions[i]!;
    const data = verifiedProofs.get(i);
    const path = identityPathForCondition(condition);
    if (!data || !path) continue;
    const value = extractJsonValue(data.revealed_body, path);
    if (value === undefined) continue;
    return createHmac("sha256", secret)
      .update(campaign.id)
      .update("\0")
      .update(condition.type)
      .update("\0")
      .update(String(value))
      .digest("hex");
  }
  return undefined;
}

function validateProofGateCampaign(
  input: CreateProofGateCampaignInput,
): string[] {
  const errors: string[] = [];
  if (!input.id?.trim()) errors.push("id is required");
  if (!input.name?.trim()) errors.push("name is required");
  if (!input.conditions?.length) {
    errors.push("at least one proof condition is required");
  }
  for (const [i, condition] of input.conditions.entries()) {
    if (!condition.type?.trim()) {
      errors.push(`conditions[${i}].type is required`);
    }
    if (!condition.target_url?.trim()) {
      errors.push(`conditions[${i}].target_url is required`);
    } else {
      try {
        new URL(condition.target_url.replace(/\{[^}]+\}/g, "placeholder"));
      } catch {
        errors.push(`conditions[${i}].target_url is invalid`);
      }
    }
    if (!condition.jsonpath?.trim()) {
      errors.push(`conditions[${i}].jsonpath is required`);
    }
    if (!condition.description?.trim()) {
      errors.push(`conditions[${i}].description is required`);
    }
    if (condition.min_value !== undefined && condition.min_value <= 0) {
      errors.push(`conditions[${i}].min_value must be positive`);
    }
  }
  if (input.token_amount_per_claim <= 0) {
    errors.push("token_amount_per_claim must be positive");
  }
  if (input.total_budget_sats <= 0) {
    errors.push("total_budget_sats must be positive");
  }
  if (
    input.token_amount_per_claim > 0 && input.total_budget_sats > 0 &&
    input.total_budget_sats < input.token_amount_per_claim
  ) {
    errors.push("total_budget_sats is less than token_amount_per_claim");
  }
  return errors;
}

function presentationHash(presentation: string): string {
  return createHash("sha256").update(presentation).digest("hex");
}

function isHexPubkey(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value) ||
    /^(02|03)[0-9a-fA-F]{64}$/.test(value);
}

function extractHostname(url: string): string | null {
  try {
    return new URL(url.replace(/\{[^}]+\}/g, "placeholder")).hostname;
  } catch {
    return null;
  }
}

function extractJsonValue(body: string, path: string): unknown {
  try {
    return resolveDotPath(JSON.parse(body), path);
  } catch {
    return undefined;
  }
}

function resolveDotPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    if (BLOCKED_PROPS.has(part)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
