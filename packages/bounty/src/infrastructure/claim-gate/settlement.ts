import { getDecodedToken, type Proof } from "@cashu/cashu-ts";
import { createHtlcToken, swapHtlcBindWorker } from "@anchr/sdk/payments";
import type {
  ProofGateCampaign,
  ProofGateClaim,
  ProofGateCondition,
  ProofGateSettlement,
} from "./types.ts";

export interface ReserveSettlementParams<
  C extends ProofGateCondition = ProofGateCondition,
> {
  campaign: ProofGateCampaign<C>;
  claimId: string;
  claimantPubkey: string;
  htlcHash: string;
  amountSats: number;
}

export interface ReleaseSettlementParams<
  C extends ProofGateCondition = ProofGateCondition,
> {
  campaign: ProofGateCampaign<C>;
  claim: ProofGateClaim<C>;
  preimage: string;
}

export interface RejectSettlementParams<
  C extends ProofGateCondition = ProofGateCondition,
> {
  campaign: ProofGateCampaign<C>;
  claim: ProofGateClaim<C>;
  reason: string;
}

export interface ProofGateSettlementProvider<
  C extends ProofGateCondition = ProofGateCondition,
> {
  reserveClaimSettlement(
    params: ReserveSettlementParams<C>,
  ): Promise<ProofGateSettlement>;
  releaseClaimSettlement(
    params: ReleaseSettlementParams<C>,
  ): Promise<ProofGateSettlement>;
  rejectClaimSettlement?(params: RejectSettlementParams<C>): Promise<void>;
}

export interface CoreCashuProofGateSettlementOptions {
  requesterRefundPubkey: string;
  locktimeSeconds: number | ((params: ReserveSettlementParams) => number);
  sourceProofsResolver: (
    amountSats: number,
    params: ReserveSettlementParams,
  ) => Promise<Proof[]>;
  mintUrl?: string;
}

export function createCoreCashuProofGateSettlementProvider<
  C extends ProofGateCondition = ProofGateCondition,
>(
  opts: CoreCashuProofGateSettlementOptions,
): ProofGateSettlementProvider<C> {
  return {
    async reserveClaimSettlement(params) {
      const locktime = typeof opts.locktimeSeconds === "function"
        ? opts.locktimeSeconds(params)
        : opts.locktimeSeconds;
      const sourceProofs = await opts.sourceProofsResolver(
        params.amountSats,
        params,
      );
      const hold = await createHtlcToken(params.amountSats, {
        hash: params.htlcHash,
        requesterPubkey: opts.requesterRefundPubkey,
        locktimeSeconds: locktime,
      }, sourceProofs);
      if (!hold) {
        return failedSettlement(
          params,
          "cashu_htlc",
          "failed to create Cashu hold token",
          locktime,
          opts.mintUrl,
        );
      }
      const bound = await swapHtlcBindWorker(hold.proofs, {
        hash: params.htlcHash,
        workerPubkey: params.claimantPubkey,
        requesterRefundPubkey: opts.requesterRefundPubkey,
        locktimeSeconds: locktime,
      });
      if (!bound) {
        return failedSettlement(
          params,
          "cashu_htlc",
          "failed to bind Cashu HTLC token to claimant",
          locktime,
          opts.mintUrl,
        );
      }
      return {
        type: "cashu_htlc",
        status: "locked",
        htlc_hash: params.htlcHash,
        amount_sats: bound.amountSats,
        claimant_pubkey: params.claimantPubkey,
        cashu_token: bound.token,
        mint_url: opts.mintUrl,
        locktime_seconds: locktime,
      };
    },
    releaseClaimSettlement(params) {
      const settlement = params.claim.settlement;
      return Promise.resolve({
        type: settlement?.type ?? "cashu_htlc",
        status: "released",
        htlc_hash: params.claim.htlc_hash,
        amount_sats: settlement?.amount_sats ??
          params.campaign.token_amount_per_claim,
        claimant_pubkey: params.claim.claimant_pubkey,
        cashu_token: settlement?.cashu_token,
        mint_url: settlement?.mint_url ?? opts.mintUrl,
        locktime_seconds: settlement?.locktime_seconds,
      });
    },
  };
}

export interface TokenBankSettlementOptions {
  requesterRefundPubkey: string;
  sourceTokens: string[];
  locktimeSeconds: number;
  mintUrl?: string;
}

export function createCashuTokenBankProofGateSettlementProvider<
  C extends ProofGateCondition = ProofGateCondition,
>(
  opts: TokenBankSettlementOptions,
): ProofGateSettlementProvider<C> {
  const tokens = [...opts.sourceTokens];
  return createCoreCashuProofGateSettlementProvider<C>({
    requesterRefundPubkey: opts.requesterRefundPubkey,
    locktimeSeconds: opts.locktimeSeconds,
    mintUrl: opts.mintUrl,
    sourceProofsResolver: async (amountSats) => {
      while (tokens.length > 0) {
        const token = tokens.shift()!;
        const decoded = getDecodedToken(token);
        const amount = decoded.proofs.reduce(
          (sum: number, proof: Proof) => sum + proof.amount,
          0,
        );
        if (amount >= amountSats) return decoded.proofs;
      }
      throw new Error("Cashu token bank exhausted");
    },
  });
}

function failedSettlement(
  params: ReserveSettlementParams,
  type: string,
  error: string,
  locktimeSeconds?: number,
  mintUrl?: string,
): ProofGateSettlement {
  return {
    type,
    status: "failed",
    htlc_hash: params.htlcHash,
    amount_sats: params.amountSats,
    claimant_pubkey: params.claimantPubkey,
    locktime_seconds: locktimeSeconds,
    mint_url: mintUrl,
    error,
  };
}
