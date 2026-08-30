/**
 * Shared helpers for Cashu escrow operations.
 */

import type { P2PKOptions, Proof } from "@cashu/cashu-ts";
import { getEncodedToken } from "@cashu/cashu-ts";
import {
  type CashuConfig,
  type CashuConfigOptions,
  getCashuConfig,
  getCashuWallet,
} from "./cashu-wallet.ts";

export async function getWalletAndConfig(options?: CashuConfigOptions): Promise<
  {
    wallet: NonNullable<ReturnType<typeof getCashuWallet>>;
    config: CashuConfig;
  } | null
> {
  const wallet = getCashuWallet({ config: options?.config });
  const config = getCashuConfig({ config: options?.config });
  if (!wallet || !config) return null;
  await wallet.loadMint();
  return { wallet, config };
}

export function sumProofAmounts(proofs: Proof[]): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

export function encodeProofs(mintUrl: string, proofs: Proof[]): string {
  // The interoperable v0 contract requires Cashu V4 ("cashuB") serialization;
  // never rely on the library default shifting underneath the contract.
  return getEncodedToken({ mint: mintUrl, proofs }, { version: 4 });
}

export async function loadAndSend(
  wallet: ReturnType<typeof getCashuWallet> & object,
  amountSats: number,
  proofs: Proof[],
  p2pkOptions?: P2PKOptions,
  privkey?: string,
  timeoutMs: number = 30_000,
): Promise<Proof[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`Cashu mint operation timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      );
    });

    const operation = async () => {
      // loadMint() must complete before accessing wallet.ops — cashu-ts v3
      // requires keyset/keychain data to be loaded before building operations.
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
    };

    return await Promise.race([operation(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
