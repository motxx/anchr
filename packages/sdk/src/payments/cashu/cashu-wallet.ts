/**
 * Cashu ecash wallet for Anchr.
 *
 * Provides anonymous payment capabilities:
 * - Mint tokens from a Cashu mint (backed by Lightning sats)
 * - Lock tokens to queries (escrow)
 * - Release tokens to providers on verification success
 * - Refund tokens on verification failure
 *
 * Privacy properties:
 * - Blind signatures: mint cannot link token issuance to redemption
 * - No identity required for minting or redeeming
 * - Tokens are bearer instruments (like physical cash)
 */

import {
  getDecodedToken,
  getEncodedToken,
  type Proof,
  Wallet,
} from "@cashu/cashu-ts";

import { getLogger } from "../../internal/runtime/logger.ts";
const log = getLogger(["anchr", "cashu"]);

export interface CashuConfig {
  mintUrl: string;
}

export function getCashuConfig(): CashuConfig | null {
  const mintUrl = Deno.env.get("CASHU_MINT_URL")?.trim();
  if (!mintUrl) return null;
  return { mintUrl };
}

export function getCashuWallet(): Wallet | null {
  const config = getCashuConfig();
  if (!config) return null;
  return new Wallet(config.mintUrl, { unit: "sat" });
}

/** Options for {@link createBountyToken}. */
export interface CreateBountyTokenOptions {
  /** Interval (ms) between mint-quote state polls. Default 2000. */
  pollIntervalMs?: number;
  /** Total wait for the Lightning invoice to be paid before giving up. Default 5 min. */
  invoiceTimeoutMs?: number;
  /**
   * Optional hook fired once the mint has issued the invoice. The caller can
   * pay it however they like (regtest auto-pay, separate Lightning wallet,
   * external coordinator). Returning a rejected promise aborts the poll loop.
   */
  onInvoice?: (bolt11: string) => Promise<void> | void;
}

/**
 * Create a locked ecash token for a query payment_lock.
 *
 * Steps:
 *   1. Ask the mint for a Lightning invoice for `amountSats`.
 *   2. Notify the caller of the invoice (via `onInvoice` and a log line).
 *   3. Poll the mint's quote state until it reports `PAID`.
 *   4. Mint blinded proofs against the paid quote and return a token.
 *
 * Returns `null` if no Cashu mint is configured (unset `CASHU_MINT_URL`),
 * if the invoice is not paid before `invoiceTimeoutMs`, or if any step
 * fails. The token can be redeemed by the provider after verification.
 */
export async function createBountyToken(
  amountSats: number,
  opts?: CreateBountyTokenOptions,
): Promise<
  {
    token: string;
    proofs: Proof[];
  } | null
> {
  const wallet = getCashuWallet();
  if (!wallet) return null;

  const pollInterval = opts?.pollIntervalMs ?? 2_000;
  const timeoutMs = opts?.invoiceTimeoutMs ?? 5 * 60_000;

  try {
    await wallet.loadMint();
    const mintQuote = await wallet.createMintQuote(amountSats);
    log.info(
      `Pay this invoice to mint ${amountSats} sats: ${mintQuote.request}`,
    );
    if (opts?.onInvoice) await opts.onInvoice(mintQuote.request);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await wallet.checkMintQuoteBolt11(mintQuote.quote);
      if (state.state === "PAID") break;
      if (state.state === "ISSUED") {
        log.error("Mint quote already issued — proofs were minted elsewhere");
        return null;
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }
    const finalState = await wallet.checkMintQuoteBolt11(mintQuote.quote);
    if (finalState.state !== "PAID") {
      log.error(
        `Lightning invoice not paid within ${timeoutMs}ms (state=${finalState.state})`,
      );
      return null;
    }

    const proofs = await wallet.mintProofs(amountSats, mintQuote.quote);
    const token = getEncodedToken({
      mint: getCashuConfig()!.mintUrl,
      proofs,
    });
    return { token, proofs };
  } catch (error) {
    log.error(
      "Failed to create payment_lock token:",
      error instanceof Error ? error.message : error,
    );
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
export async function verifyToken(
  token: string,
  expectedMinSats?: number,
): Promise<{
  valid: boolean;
  amountSats: number;
  error?: string;
}> {
  try {
    const decoded = getDecodedToken(token);
    const totalAmount = decoded.proofs.reduce(
      (sum: number, p: Proof) => sum + p.amount,
      0,
    );

    if (expectedMinSats && totalAmount < expectedMinSats) {
      return {
        valid: false,
        amountSats: totalAmount,
        error: `Insufficient amount: ${totalAmount} < ${expectedMinSats}`,
      };
    }

    // Query the Cashu mint to verify proofs are actually unspent
    const wallet = getCashuWallet();
    if (wallet) {
      try {
        await wallet.loadMint();
        const states = await wallet.checkProofsStates(decoded.proofs);
        const spent = states.filter((s) => s.state !== "UNSPENT");
        if (spent.length > 0) {
          return {
            valid: false,
            amountSats: totalAmount,
            error: `${spent.length} proof(s) already spent on mint`,
          };
        }
        log.error(
          `Token verified on mint: ${totalAmount} sats, ${decoded.proofs.length} proofs UNSPENT`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Mint checkstate failed:`, msg);
        return {
          valid: false,
          amountSats: totalAmount,
          error: `Mint verification failed: ${msg}`,
        };
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
