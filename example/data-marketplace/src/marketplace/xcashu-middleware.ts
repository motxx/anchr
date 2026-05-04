// HTTP 402 flow for marketplace payments. SHA-256(token) replay detection
// runs in front of the Mint's own spent-proof check (defense in depth).

import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { verifyToken } from "@anchr/core-cashu/wallet";
import { getCashuConfig } from "@anchr/core-cashu/wallet";
import type { DataListing, MarketplaceEnv, PaymentInfo } from "./types.ts";

/** Set of token hashes already seen (defense-in-depth replay detection). */
const seenTokens = new Set<string>();

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Build a 402 Payment Required response with pricing headers.
 */
function build402Response(listing: DataListing) {
  const config = getCashuConfig();
  const mintUrl = config?.mintUrl ?? "not-configured";

  return new Response(
    JSON.stringify({
      error: "Payment Required",
      listing_id: listing.id,
      name: listing.name,
      price_sats: listing.price_sats,
      htlc_price_sats: listing.htlc_price_sats,
      payment_methods: ["cashu-direct", "cashu-htlc"],
      mint: mintUrl,
    }),
    {
      status: 402,
      headers: {
        "content-type": "application/json",
        "x-price": String(listing.price_sats),
        "x-htlc-price": String(listing.htlc_price_sats),
        "x-payment-methods": "cashu-direct, cashu-htlc",
        "x-cashu-mint": mintUrl,
      },
    },
  );
}

/**
 * Create payment middleware that resolves the listing from the route param.
 *
 * On success, sets `c.set("paymentInfo", PaymentInfo)` for downstream handlers.
 */
export function createPaymentMiddleware(
  resolveListing: (id: string) => DataListing | null,
): MiddlewareHandler<MarketplaceEnv> {
  return async (c, next) => {
    const listingId = c.req.param("id");
    if (!listingId) {
      return c.json({ error: "Listing id is required" }, 400);
    }

    const listing = resolveListing(listingId);
    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }
    if (!listing.active) {
      return c.json({ error: "Listing is no longer active" }, 410);
    }

    // --- Check for HTLC mode ---
    const escrowToken = c.req.header("x-cashu-htlc");
    if (escrowToken) {
      const htlcHash = c.req.header("x-htlc-hash");
      if (!htlcHash) {
        return c.json({ error: "X-Htlc-Hash header required for HTLC mode" }, 400);
      }

      const tokenHash = sha256Hex(escrowToken);
      if (seenTokens.has(tokenHash)) {
        return c.json({ error: "Token already used" }, 409);
      }

      const result = await verifyToken(escrowToken, listing.htlc_price_sats);
      if (!result.valid) {
        return new Response(
          JSON.stringify({ error: "Payment verification failed", detail: result.error }),
          {
            status: 402,
            headers: {
              "content-type": "application/json",
              "x-price": String(listing.htlc_price_sats),
              "x-cashu-mint": getCashuConfig()?.mintUrl ?? "not-configured",
            },
          },
        );
      }

      seenTokens.add(tokenHash);

      const paymentInfo: PaymentInfo = {
        mode: "cashu-htlc",
        amount_sats: result.amountSats,
        token: escrowToken,
        token_hash: tokenHash,
        htlc_hash: htlcHash,
      };
      c.set("paymentInfo", paymentInfo);
      return next();
    }

    // --- Check for direct X-Cashu mode ---
    const directToken = c.req.header("x-cashu");
    if (directToken) {
      const tokenHash = sha256Hex(directToken);
      if (seenTokens.has(tokenHash)) {
        return c.json({ error: "Token already used" }, 409);
      }

      const result = await verifyToken(directToken, listing.price_sats);
      if (!result.valid) {
        return new Response(
          JSON.stringify({ error: "Payment verification failed", detail: result.error }),
          {
            status: 402,
            headers: {
              "content-type": "application/json",
              "x-price": String(listing.price_sats),
              "x-cashu-mint": getCashuConfig()?.mintUrl ?? "not-configured",
            },
          },
        );
      }

      seenTokens.add(tokenHash);

      const paymentInfo: PaymentInfo = {
        mode: "cashu-direct",
        amount_sats: result.amountSats,
        token: directToken,
        token_hash: tokenHash,
      };
      c.set("paymentInfo", paymentInfo);
      return next();
    }

    // --- No payment → 402 ---
    return build402Response(listing);
  };
}

/** Visible for testing — clear the replay detection set. */
export function _clearSeenTokensForTest(): void {
  seenTokens.clear();
}
