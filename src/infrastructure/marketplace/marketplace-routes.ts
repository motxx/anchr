/**
 * Marketplace HTTP route registration.
 *
 * All routes are under /marketplace/* and do not touch existing /queries/* routes.
 * Follows the registerXxxRoutes(app, ctx) pattern from worker-api-routes.ts.
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createListingSchema } from "./marketplace-schemas";
import { createPaymentMiddleware } from "./xcashu-middleware";
import { fetchWithProof, validateMarketplaceProof } from "./data-fetcher";
import { validateAttachmentUri } from "../url-validation";
import { announceListingOnNostr } from "./nostr-announce";
import type { MarketplaceEnv, MarketplaceRouteContext, PurchaseRecord } from "./types";

/** In-memory purchase log (replay defense + audit). */
const purchaseLog = new Map<string, PurchaseRecord>();

// deno-lint-ignore no-explicit-any
export function registerMarketplaceRoutes(app: Hono<any>, ctx: MarketplaceRouteContext): void {
  const { listingStore, preimageStore, writeAuth, rateLimit } = ctx;
  const mkt = new Hono<MarketplaceEnv>();

  // --- Listings CRUD ---

  // Public listing response — omit source_url to prevent leaking internal URLs.
  // deno-lint-ignore no-explicit-any
  function publicListing(listing: any) {
    const { source_url: _url, ...rest } = listing;
    return rest;
  }

  mkt.get("/listings", (c) => {
    return c.json(listingStore.listActive().map(publicListing));
  });

  mkt.get("/listings/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Listing id is required" }, 400);
    const listing = listingStore.get(id);
    if (!listing) return c.json({ error: "Listing not found" }, 404);
    return c.json(publicListing(listing));
  });

  mkt.post(
    "/listings",
    rateLimit,
    writeAuth,
    // deno-lint-ignore no-explicit-any -- Zod v4 ZodObject is not assignable to @hono/zod-validator's ZodSchema (Zod v3 type)
    zValidator("json", createListingSchema as any, (result, c) => {
      if (!result.success) {
        return c.json({
          error: "Invalid listing payload",
          issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        }, 400);
      }
    }) as unknown as MiddlewareHandler,
    (c) => {
      const payload = c.req.valid("json" as never) as ReturnType<typeof createListingSchema.parse>;
      // Validate source_url at creation time (not just at fetch time) to prevent
      // storing SSRF targets and leaking them via GET /marketplace/listings.
      const urlError = validateAttachmentUri(payload.source_url);
      if (urlError) {
        return c.json({ error: `source_url rejected: ${urlError}` }, 400);
      }

      const id = `listing_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      listingStore.set(id, {
        id,
        name: payload.name,
        description: payload.description,
        source_url: payload.source_url,
        price_sats: payload.price_sats,
        htlc_price_sats: payload.htlc_price_sats,
        tlsn_requirement: payload.tlsn_requirement,
        max_age_seconds: payload.max_age_seconds,
        active: true,
        created_at: Date.now(),
        provider_pubkey: payload.provider_pubkey,
      });
      return c.json(publicListing(listingStore.get(id)), 201);
    },
  );

  mkt.delete("/listings/:id", writeAuth, (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Listing id is required" }, 400);
    const listing = listingStore.get(id);
    if (!listing) return c.json({ error: "Listing not found" }, 404);
    listing.active = false;
    listingStore.set(id, listing);
    return c.json({ ok: true, id, active: false });
  });

  // --- Data Purchase ---

  mkt.get("/data/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Listing id is required" }, 400);
    const listing = listingStore.get(id);
    if (!listing) return c.json({ error: "Listing not found" }, 404);
    if (!listing.active) return c.json({ error: "Listing is no longer active" }, 410);
    return c.json({
      listing_id: listing.id,
      name: listing.name,
      description: listing.description,
      price_sats: listing.price_sats,
      htlc_price_sats: listing.htlc_price_sats,
      payment_methods: ["cashu-direct", "cashu-htlc"],
      hint: "POST /marketplace/data/:id with X-Cashu or X-Cashu-Htlc header to purchase.",
    }, 402);
  });

  const paymentMiddleware = createPaymentMiddleware((id) => listingStore.get(id));

  mkt.post("/data/:id", rateLimit, paymentMiddleware, async (c) => {
    const id = c.req.param("id")!;
    const listing = listingStore.get(id)!; // guaranteed by middleware
    const paymentInfo = c.get("paymentInfo");

    const record: PurchaseRecord = {
      listing_id: id,
      token_hash: paymentInfo.token_hash,
      mode: paymentInfo.mode,
      amount_sats: paymentInfo.amount_sats,
      purchased_at: Date.now(),
    };
    purchaseLog.set(paymentInfo.token_hash, record);

    try {
      const fetched = await fetchWithProof(id, listing.source_url, listing.max_age_seconds);

      if (paymentInfo.mode === "cashu-htlc") {
        if (fetched.attestation) {
          const validation = await validateMarketplaceProof(
            fetched.attestation,
            listing.tlsn_requirement,
          );
          if (validation.failures.length > 0) {
            return c.json({
              error: "TLSNotary proof validation failed",
              failures: validation.failures,
            }, 422);
          }
        }

        return c.json({
          listing_id: id,
          name: listing.name,
          data: fetched.body,
          fetched_at: fetched.fetched_at,
          payment_mode: "cashu-htlc",
          htlc_hash: paymentInfo.htlc_hash,
          note: "HTLC settlement: Oracle will verify proof and release preimage via Nostr DM.",
        });
      }

      return c.json({
        listing_id: id,
        name: listing.name,
        data: fetched.body,
        fetched_at: fetched.fetched_at,
        payment_mode: "cashu-direct",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[marketplace] Fetch failed for listing ${id}:`, msg);
      return c.json({ error: "Failed to fetch upstream data", detail: msg }, 502);
    }
  });

  // --- Nostr Announcement ---

  mkt.post("/listings/:id/announce", rateLimit, writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Listing id is required" }, 400);
    const listing = listingStore.get(id);
    if (!listing) return c.json({ error: "Listing not found" }, 404);
    if (!listing.active) return c.json({ error: "Cannot announce inactive listing" }, 410);

    try {
      const result = await announceListingOnNostr(listing);
      return c.json({ ok: true, listing_id: id, nostr: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "Nostr announcement failed", detail: msg }, 500);
    }
  });

  app.route("/marketplace", mkt);
}

/** Visible for testing — clear purchase log. */
export function _clearPurchaseLogForTest(): void {
  purchaseLog.clear();
}
