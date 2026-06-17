import {
  CheckStateEnum,
  OutputData,
  type OutputDataLike,
  type P2PKOptions,
  type Proof,
  type SerializedBlindedMessage,
  type SerializedBlindedSignature,
} from "@cashu/cashu-ts";

import { sumProofAmounts } from "./cashu-escrow-helpers.ts";

export interface CashuRedeemSendChain {
  asP2PK(options: P2PKOptions): CashuRedeemSendChain;
  privkey(k: string | string[]): CashuRedeemSendChain;
  asCustom?(data: OutputDataLike[]): CashuRedeemSendChain;
  run(): Promise<{ send: Proof[]; keep?: Proof[] }>;
}

export interface CashuRedeemWallet {
  ops: {
    send(amount: number, proofs: Proof[]): CashuRedeemSendChain;
  };
  getFeesForProofs(proofs: Proof[]): number;
  checkProofsStates?(
    proofs: Array<Pick<Proof, "secret">>,
  ): Promise<Array<{ state: string }>>;
  getKeyset?(): { id: string; keys: Record<number, string> };
  mint?: {
    restore(payload: { outputs: SerializedBlindedMessage[] }): Promise<{
      outputs: SerializedBlindedMessage[];
      signatures: SerializedBlindedSignature[];
    }>;
  };
}

export type RedeemSwapFailureReason =
  | "fee_exceeds_amount"
  | "mint_error"
  | "state_unknown"
  | "inputs_unspent"
  | "outputs_not_registered"
  | "restore_failed"
  | "restore_empty";

export type RedeemSwapResult =
  | {
    ok: true;
    proofs: Proof[];
    amountSats: number;
    recovered: boolean;
  }
  | {
    ok: false;
    reason: RedeemSwapFailureReason;
    retrySafe: boolean;
    uncertain: boolean;
    fee?: number;
    totalAmount?: number;
    cause?: unknown;
  };

export async function redeemSignedProofs(params: {
  wallet: CashuRedeemWallet;
  signedProofs: Proof[];
  signingPrivateKey?: string;
}): Promise<RedeemSwapResult> {
  const totalAmount = sumProofAmounts(params.signedProofs);
  const fee = params.wallet.getFeesForProofs(params.signedProofs);
  const swapAmount = totalAmount - fee;
  if (swapAmount <= 0) {
    return {
      ok: false,
      reason: "fee_exceeds_amount",
      retrySafe: false,
      uncertain: false,
      fee,
      totalAmount,
    };
  }

  const keyset = params.wallet.getKeyset?.();
  let outputData: OutputData[] | null = null;
  let chain = params.wallet.ops.send(swapAmount, params.signedProofs);
  if (params.signingPrivateKey !== undefined) {
    chain = chain.privkey(params.signingPrivateKey);
  }
  if (keyset && chain.asCustom) {
    outputData = OutputData.createRandomData(swapAmount, keyset);
    chain = chain.asCustom(outputData);
  }

  try {
    const result = await chain.run();
    return {
      ok: true,
      proofs: result.send,
      amountSats: sumProofAmounts(result.send),
      recovered: false,
    };
  } catch (err) {
    return recoverInterruptedRedeem(
      params.wallet,
      params.signedProofs,
      outputData,
      keyset,
      err,
    );
  }
}

async function recoverInterruptedRedeem(
  wallet: CashuRedeemWallet,
  inputs: Proof[],
  outputData: OutputData[] | null,
  keyset: { id: string; keys: Record<number, string> } | undefined,
  cause: unknown,
): Promise<RedeemSwapResult> {
  if (!wallet.checkProofsStates) {
    return {
      ok: false,
      reason: "mint_error",
      retrySafe: false,
      uncertain: false,
      cause,
    };
  }

  let states: Array<{ state: string }>;
  try {
    states = await wallet.checkProofsStates(inputs);
  } catch (stateErr) {
    return {
      ok: false,
      reason: "state_unknown",
      retrySafe: false,
      uncertain: true,
      cause: stateErr,
    };
  }

  const anySpent = states.some((s) => s.state === CheckStateEnum.SPENT);
  if (!anySpent) {
    return {
      ok: false,
      reason: "inputs_unspent",
      retrySafe: true,
      uncertain: false,
      cause,
    };
  }

  if (!outputData || !keyset || !wallet.mint) {
    return {
      ok: false,
      reason: "outputs_not_registered",
      retrySafe: false,
      uncertain: true,
      cause,
    };
  }

  let restored: {
    outputs: SerializedBlindedMessage[];
    signatures: SerializedBlindedSignature[];
  };
  try {
    restored = await wallet.mint.restore({
      outputs: outputData.map((o) => o.blindedMessage),
    });
  } catch (restoreErr) {
    return {
      ok: false,
      reason: "restore_failed",
      retrySafe: false,
      uncertain: true,
      cause: restoreErr,
    };
  }

  const byBlindedMessage = new Map(
    outputData.map((o) => [o.blindedMessage.B_, o]),
  );
  const recovered: Proof[] = [];
  for (let i = 0; i < restored.outputs.length; i++) {
    const restoredOutput = restored.outputs[i];
    const signature = restored.signatures[i];
    if (restoredOutput === undefined || signature === undefined) continue;
    const data = byBlindedMessage.get(restoredOutput.B_);
    if (data === undefined) continue;
    recovered.push(data.toProof(signature, keyset));
  }
  if (recovered.length === 0) {
    return {
      ok: false,
      reason: "restore_empty",
      retrySafe: false,
      uncertain: true,
      cause,
    };
  }
  return {
    ok: true,
    proofs: recovered,
    amountSats: sumProofAmounts(recovered),
    recovered: true,
  };
}
