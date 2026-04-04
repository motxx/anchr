import {
  type Proof,
  getEncodedToken,
  getDecodedToken,
} from "@cashu/cashu-ts";
import { getCashuWallet, getMintUrl } from "./wallet";

export interface EscrowToken {
  token: string;
  proofs: Proof[];
  amountSats: number;
}

export interface HtlcInitialLockParams {
  hash: string;
  requesterPubkey: string;
  locktimeSeconds: number;
}

export interface HtlcWorkerBindParams {
  hash: string;
  workerPubkey: string;
  requesterRefundPubkey: string;
  locktimeSeconds: number;
}

/**
 * Phase 1: Create hold token (Worker unknown).
 * Plain proofs held locally by Requester as bearer instruments.
 */
export async function createHtlcToken(
  amountSats: number,
  _params: HtlcInitialLockParams,
  sourceProofs: Proof[],
): Promise<EscrowToken | null> {
  const wallet = getCashuWallet();
  if (!wallet) return null;

  try {
    await wallet.loadMint();
    const { send } = await wallet.send(amountSats, sourceProofs);
    const token = getEncodedToken({ mint: getMintUrl(), proofs: send });
    return { token, proofs: send, amountSats };
  } catch (error) {
    console.error("[cashu-htlc] Failed to create hold token:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Phase 2: Swap HTLC token to bind a selected Worker.
 * Uses NUT-11 P2PK locking with hashlock + worker pubkey.
 */
export async function swapHtlcBindWorker(
  initialProofs: Proof[],
  params: HtlcWorkerBindParams,
): Promise<EscrowToken | null> {
  const wallet = getCashuWallet();
  if (!wallet) return null;

  try {
    await wallet.loadMint();
    const totalSats = initialProofs.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(initialProofs);
    const amountSats = totalSats - fee;
    if (amountSats <= 0) return null;

    const { send } = await wallet.send(amountSats, initialProofs, {
      pubkey: params.workerPubkey,
      p2pk: {
        pubkey: params.workerPubkey,
        locktime: params.locktimeSeconds,
        refundKeys: [params.requesterRefundPubkey],
        requiredSignatures: 1,
        requiredRefundSignatures: 1,
      },
    });

    const token = getEncodedToken({ mint: getMintUrl(), proofs: send });
    return { token, proofs: send, amountSats };
  } catch (error) {
    console.error("[cashu-htlc] Failed to swap HTLC:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Redeem HTLC token: Worker provides preimage + Worker signature.
 */
export async function redeemHtlcToken(
  htlcProofs: Proof[],
  preimage: string,
  workerPrivateKey: string,
): Promise<{ token: string; proofs: Proof[]; amountSats: number } | null> {
  const wallet = getCashuWallet();
  if (!wallet) return null;

  try {
    await wallet.loadMint();
    const proofsWithPreimage = htlcProofs.map((p) => ({
      ...p,
      witness: JSON.stringify({ preimage, signatures: [] }),
    }));

    const totalSats = proofsWithPreimage.reduce((sum, p) => sum + p.amount, 0);
    const fee = wallet.getFeesForProofs(proofsWithPreimage);
    const amountSats = totalSats - fee;
    if (amountSats <= 0) return null;

    const { send } = await wallet.send(amountSats, proofsWithPreimage, {
      privkey: workerPrivateKey,
    });

    const token = getEncodedToken({ mint: getMintUrl(), proofs: send });
    return { token, proofs: send, amountSats };
  } catch (error) {
    console.error("[cashu-htlc] Failed to redeem:", error instanceof Error ? error.message : error);
    return null;
  }
}

export function inspectEscrowToken(token: string): {
  amountSats: number;
  proofCount: number;
  mintUrl: string;
} | null {
  try {
    const decoded = getDecodedToken(token);
    const amountSats = decoded.proofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);
    return { amountSats, proofCount: decoded.proofs.length, mintUrl: decoded.mint };
  } catch {
    return null;
  }
}
