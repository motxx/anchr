import type { TlsnVerifiedData } from "@anchr/tlsn-toolkit/tlsn-types";

export type ProofGateStatus = "draft" | "live" | "paused" | "closed";
export type ProofGateClaimStatus = "reserved" | "approved" | "rejected";

export interface ProofGateCondition {
  type: string;
  target_url: string;
  min_value?: number;
  jsonpath: string;
  description: string;
}

export interface ProofGateCampaign<
  C extends ProofGateCondition = ProofGateCondition,
> {
  id: string;
  name: string;
  conditions: C[];
  token_amount_per_claim: number;
  total_budget_sats: number;
  escrow_token?: string;
  status: ProofGateStatus;
  created_at: number;
  updated_at: number;
  mint_url?: string;
  public_base_url?: string;
}

export interface ClaimProof {
  condition_index: number;
  presentation: string;
}

export interface ConditionResult<
  C extends ProofGateCondition = ProofGateCondition,
> {
  condition: C;
  passed: boolean;
  extracted_value?: string | number;
  reason: string;
}

export interface ClaimVerificationResult<
  C extends ProofGateCondition = ProofGateCondition,
> {
  all_passed: boolean;
  results: Array<ConditionResult<C>>;
  preimage?: string;
  settlement?: ProofGateSettlement;
  checks: string[];
  failures: string[];
}

export type ProofGateSettlementStatus =
  | "reserved"
  | "locked"
  | "released"
  | "failed";

export interface ProofGateSettlement {
  type: "preimage_only" | "cashu_htlc" | string;
  status: ProofGateSettlementStatus;
  htlc_hash: string;
  amount_sats: number;
  claimant_pubkey: string;
  cashu_token?: string;
  mint_url?: string;
  locktime_seconds?: number;
  error?: string;
}

export interface ProofGateClaim<
  C extends ProofGateCondition = ProofGateCondition,
> {
  id: string;
  campaign_id: string;
  claimant_pubkey: string;
  htlc_hash: string;
  preimage: string;
  status: ProofGateClaimStatus;
  nullifier_hash?: string;
  settlement?: ProofGateSettlement;
  results?: Array<ConditionResult<C>>;
  failures?: string[];
  created_at: number;
  updated_at: number;
}

export interface ProofGateStore<
  C extends ProofGateCondition = ProofGateCondition,
> {
  upsertCampaign(campaign: ProofGateCampaign<C>): Promise<void>;
  getCampaign(id: string): Promise<ProofGateCampaign<C> | undefined>;
  listCampaigns(): Promise<Array<ProofGateCampaign<C>>>;
  createClaim(claim: ProofGateClaim<C>): Promise<void>;
  getClaim(id: string): Promise<ProofGateClaim<C> | undefined>;
  updateClaim(claim: ProofGateClaim<C>): Promise<void>;
  approvedClaimCount(campaignId: string): Promise<number>;
  findApprovedByNullifier(
    campaignId: string,
    nullifierHash: string,
  ): Promise<ProofGateClaim<C> | undefined>;
  reservePresentationHashes(
    campaignId: string,
    claimId: string,
    hashes: string[],
  ): Promise<boolean>;
  close(): Promise<void>;
}

export type VerifiedProofData = TlsnVerifiedData;
