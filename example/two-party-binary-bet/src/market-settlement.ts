/**
 * Market settlement — shared logic between the manual /resolve HTTP
 * handler and the background auto-resolver.
 *
 * Given a resolved outcome (yes/no), this module:
 *   1. Drives the Oracle signing path (FROST P2PK preferred, HTLC preimage
 *      fallback) and stores per-proof signatures.
 *   2. Updates the market status to resolved_yes / resolved_no.
 *   3. Marks all open matched pairs as settled.
 *
 * It does NOT decide the outcome — that's the caller's responsibility
 * (HTTP body in the manual case, TLSNotary-verified condition evaluation
 * in the auto case).
 */

import { getDecodedToken } from "@cashu/cashu-ts";
import {
  frostDualKeySignAsync,
  frostSignProofSecretsAsync,
} from "@anchr/cashu-conditional-swap/frost-dual-key-store";
import type { MarketStatus, MatchedBetPair } from "./market-types.ts";
import { resolveMarket as revealHtlcPreimage } from "./resolution.ts";
import type { MarketState } from "./server-routes.ts";

export interface SettleMarketOpts {
  /** TLSNotary-verified response body, included in FROST signing context. */
  verifiedBody?: string;
}

export interface SettledPair {
  pair_id: string;
  winner_pubkey: string;
  amount_sats: number;
}

export type SettleMarketResult =
  | {
    ok: true;
    market_id: string;
    outcome: "yes" | "no";
    mode: "frost_p2pk" | "htlc";
    status: MarketStatus;
    preimage?: string;
    oracle_signature?: string;
    proof_signatures_count?: number;
    yes_pool_sats: number;
    no_pool_sats: number;
    settled_pairs: SettledPair[];
  }
  | {
    ok: false;
    error: string;
    /** Suggested HTTP status for callers that surface this over HTTP. */
    status: number;
    mode?: "frost_p2pk" | "htlc";
  };

/**
 * Settle a market with the given outcome. Returns a structured result
 * the caller can either return as JSON (HTTP handler) or log + react to
 * (auto-resolver).
 */
export async function settleMarket(
  state: MarketState,
  marketId: string,
  outcome: "yes" | "no",
  opts?: SettleMarketOpts,
): Promise<SettleMarketResult> {
  const market = state.markets.get(marketId);
  if (!market) return { ok: false, error: "Market not found", status: 404 };

  if (market.status !== "open" && market.status !== "closed") {
    return {
      ok: false,
      error: `Market cannot be resolved (status: ${market.status})`,
      status: 409,
    };
  }

  const useFrost = !!market.group_pubkey_yes &&
    !!market.group_pubkey_no &&
    state.dualKeyStore.has(marketId);

  let resolvedPreimage: string | undefined;
  let oracleSignature: string | undefined;
  let proofSigCount: number | undefined;

  if (useFrost) {
    const swapOutcome = outcome === "yes" ? "a" : "b";

    // Collect proof secrets from all matched pairs' winning redeemable tokens.
    const allProofSecrets: string[] = [];
    for (const pair of state.matchedPairs.values()) {
      if (pair.market_id !== marketId) continue;
      if (pair.status !== "locked" && pair.status !== "pending") continue;
      const redeemableToken = outcome === "yes"
        ? pair.token_no_to_yes
        : pair.token_yes_to_no;
      if (!redeemableToken) continue;
      try {
        const decoded = getDecodedToken(redeemableToken);
        for (const proof of decoded.proofs) {
          allProofSecrets.push(proof.secret);
        }
      } catch {
        // Token may be empty in demo mode (no Cashu) — skip.
      }
    }

    let proofSigs: Map<string, string> | null = null;

    if (allProofSecrets.length > 0) {
      if (state.frostMode === "frost" && state.frostConfig) {
        proofSigs = await frostSignProofSecretsAsync(
          state.frostConfig,
          swapOutcome,
          allProofSecrets,
          opts?.verifiedBody
            ? {
              condition_id: marketId,
              resolution_url: market.resolution_url,
              verified_body: opts.verifiedBody,
            }
            : undefined,
        );
      } else {
        proofSigs = state.dualKeyStore.signProofSecrets(
          marketId,
          swapOutcome,
          allProofSecrets,
        );
      }

      if (!proofSigs) {
        return {
          ok: false,
          error:
            "Resolution failed — per-proof signing failed (threshold not met or already signed)",
          status: 503,
          mode: "frost_p2pk",
        };
      }

      state.resolvedProofSignatures.set(marketId, proofSigs);
      await state.persist.proofSignatures(marketId, proofSigs);
      proofSigCount = proofSigs.size;

      const firstSig = proofSigs.values().next().value;
      if (firstSig) {
        oracleSignature = firstSig;
        state.resolvedSignatures.set(marketId, firstSig);
        await state.persist.signature(marketId, firstSig);
      }
    } else {
      // Demo mode without Cashu — sign a market-level message.
      const signMessage = new TextEncoder().encode(`${marketId}:${outcome}`);
      let sig: string | null = null;

      if (state.frostMode === "frost" && state.frostConfig) {
        sig = await frostDualKeySignAsync(
          state.frostConfig,
          swapOutcome,
          signMessage,
          opts?.verifiedBody
            ? {
              condition_id: marketId,
              resolution_url: market.resolution_url,
              verified_body: opts.verifiedBody,
            }
            : undefined,
        );
      } else {
        sig = state.dualKeyStore.sign(marketId, swapOutcome, signMessage);
      }

      if (!sig) {
        return {
          ok: false,
          error:
            "Resolution failed — signing failed (threshold not met or already signed)",
          status: 503,
          mode: "frost_p2pk",
        };
      }
      oracleSignature = sig;
      state.resolvedSignatures.set(marketId, sig);
      await state.persist.signature(marketId, sig);
    }

    // Also resolve the HTLC side. Dual-mode markets keep both settlement
    // paths live so wallets that redeem via either flow get the data they need.
    revealHtlcPreimage(marketId, outcome, state.dualPreimageStore);
  } else {
    // HTLC preimage mode (fallback).
    const result = revealHtlcPreimage(
      marketId,
      outcome,
      state.dualPreimageStore,
    );
    if (!result) {
      return {
        ok: false,
        error: "Resolution failed — preimage not found or already revealed",
        status: 500,
        mode: "htlc",
      };
    }
    resolvedPreimage = result.preimage;
    state.resolvedPreimages.set(marketId, result.preimage);
    await state.persist.preimage(marketId, result.preimage);
  }

  const newStatus: MarketStatus = outcome === "yes"
    ? "resolved_yes"
    : "resolved_no";
  market.status = newStatus;
  await state.persist.market(market);

  // Clients call /redeem to retrieve their share of the matched-pair tokens.
  const settledPairs: SettledPair[] = [];
  for (
    const pair of state.matchedPairs.values() as IterableIterator<
      MatchedBetPair
    >
  ) {
    if (pair.market_id !== marketId) continue;
    if (pair.status !== "locked" && pair.status !== "pending") continue;
    pair.status = outcome === "yes" ? "settled_yes" : "settled_no";
    await state.persist.pair(pair);
    const winnerPubkey = outcome === "yes" ? pair.yes_pubkey : pair.no_pubkey;
    settledPairs.push({
      pair_id: pair.pair_id,
      winner_pubkey: winnerPubkey,
      amount_sats: pair.amount_sats,
    });
  }

  return {
    ok: true,
    market_id: marketId,
    outcome,
    mode: useFrost ? "frost_p2pk" : "htlc",
    status: newStatus,
    ...(resolvedPreimage ? { preimage: resolvedPreimage } : {}),
    ...(oracleSignature ? { oracle_signature: oracleSignature } : {}),
    ...(proofSigCount !== undefined
      ? { proof_signatures_count: proofSigCount }
      : {}),
    yes_pool_sats: market.yes_pool_sats,
    no_pool_sats: market.no_pool_sats,
    settled_pairs: settledPairs,
  };
}
