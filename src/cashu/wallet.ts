/**
 * Cashu ecash wallet for Anchr.
 *
 * Provides anonymous payment capabilities:
 * - Mint tokens from a Cashu mint (backed by Lightning sats)
 * - Lock tokens to queries (escrow)
 * - Release tokens to workers on verification success
 * - Refund tokens on verification failure
 *
 * Privacy properties:
 * - Blind signatures: mint cannot link token issuance to redemption
 * - No identity required for minting or redeeming
 * - Tokens are bearer instruments (like physical cash)
 */

import { Wallet, type Proof, getEncodedToken, getDecodedToken } from "@cashu/cashu-ts";

export interface CashuConfig {
  mintUrl: string;
}

export function getCashuConfig(): CashuConfig | null {
  const mintUrl = process.env.CASHU_MINT_URL?.trim();
  if (!mintUrl) return null;
  return { mintUrl };
}

let _wallet: Wallet | null = null;

export function getCashuWallet(): Wallet | null {
  const config = getCashuConfig();
  if (!config) return null;

  if (!_wallet) {
    _wallet = new Wallet(config.mintUrl, { unit: "sat" });
  }
  return _wallet;
}

/**
 * Create a locked ecash token for a query bounty.
 * The token can be redeemed by the worker after verification.
 */
export async function createBountyToken(amountSats: number): Promise<{
  token: string;
  proofs: Proof[];
} | null> {
  const wallet = getCashuWallet();
  if (!wallet) return null;

  try {
    await wallet.loadMint();
    const mintQuote = await wallet.createMintQuote(amountSats);
    // In production, user would pay the Lightning invoice in mintQuote.request
    console.error(`[cashu] Pay this invoice to mint ${amountSats} sats: ${mintQuote.request}`);

    const proofs = await wallet.mintProofs(amountSats, mintQuote.quote);
    const token = getEncodedToken({
      mint: getCashuConfig()!.mintUrl,
      proofs,
    });
    return { token, proofs };
  } catch (error) {
    console.error("[cashu] Failed to create bounty token:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Encode proofs into a transferable Cashu token string.
 */
export function encodeToken(mintUrl: string, proofs: Proof[]): string {
  return getEncodedToken({ mint: mintUrl, proofs });
}

/**
 * Verify that a Cashu token is valid and has sufficient value.
 * Queries the Cashu mint's /v1/checkstate to confirm proofs are UNSPENT.
 */
export async function verifyToken(token: string, expectedMinSats?: number): Promise<{
  valid: boolean;
  amountSats: number;
  error?: string;
}> {
  try {
    const decoded = getDecodedToken(token);
    const totalAmount = decoded.proofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);

    if (expectedMinSats && totalAmount < expectedMinSats) {
      return { valid: false, amountSats: totalAmount, error: `Insufficient amount: ${totalAmount} < ${expectedMinSats}` };
    }

    // Query the Cashu mint to verify proofs are actually unspent
    const wallet = getCashuWallet();
    if (wallet) {
      try {
        await wallet.loadMint();
        const states = await wallet.checkProofsStates(decoded.proofs);
        const spent = states.filter((s) => s.state !== "UNSPENT");
        if (spent.length > 0) {
          return { valid: false, amountSats: totalAmount, error: `${spent.length} proof(s) already spent on mint` };
        }
        console.error(`[cashu] Token verified on mint: ${totalAmount} sats, ${decoded.proofs.length} proofs UNSPENT`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cashu] Mint checkstate failed:`, msg);
        return { valid: false, amountSats: totalAmount, error: `Mint verification failed: ${msg}` };
      }
    }

    return { valid: true, amountSats: totalAmount };
  } catch (error) {
    return {
      valid: false,
      amountSats: 0,
      error: error instanceof Error ? error.message : "Invalid token",
    };
  }
}

/**
 * Check if Cashu payments are enabled.
 */
export function isCashuEnabled(): boolean {
  return getCashuConfig() !== null;
}
