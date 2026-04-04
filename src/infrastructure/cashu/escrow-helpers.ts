/**
 * Shared helpers for Cashu escrow operations.
 */

import type { Proof } from "@cashu/cashu-ts";
import { getEncodedToken } from "@cashu/cashu-ts";
import { getCashuWallet, getCashuConfig } from "./wallet";

export function getWalletAndConfig() {
  const wallet = getCashuWallet();
  const config = getCashuConfig();
  if (!wallet || !config) return null;
  return { wallet, config };
}

export function sumProofAmounts(proofs: Proof[]): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

export function encodeProofs(mintUrl: string, proofs: Proof[]): string {
  return getEncodedToken({ mint: mintUrl, proofs });
}

export async function loadAndSend(
  wallet: ReturnType<typeof getCashuWallet> & object,
  amountSats: number,
  proofs: Proof[],
  p2pkOptions?: import("@cashu/cashu-ts").P2PKOptions,
  privkey?: string,
): Promise<Proof[]> {
  await wallet.loadMint();
  let builder = wallet.ops.send(amountSats, proofs);
  if (p2pkOptions) {
    builder = builder.asP2PK(p2pkOptions);
  }
  if (privkey) {
    builder = builder.privkey(privkey);
  }
  const { send } = await builder.run();
  return send;
}

export function computeNetAmount(
  wallet: ReturnType<typeof getCashuWallet> & object,
  proofs: Proof[],
): number | null {
  const totalSats = sumProofAmounts(proofs);
  const fee = wallet.getFeesForProofs(proofs);
  const amountSats = totalSats - fee;
  if (amountSats <= 0) return null;
  return amountSats;
}
