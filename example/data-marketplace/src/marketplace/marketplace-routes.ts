import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { createListingSchema } from "./marketplace-schemas.ts";
import { createPaymentMiddleware } from "./xcashu-middleware.ts";
import { fetchWithProof, validateMarketplaceProof } from "./data-fetcher.ts";
import { validateAttachmentUri } from "@anchr/bounty/url-validation";
import { announceListingOnNostr } from "./nostr-announce.ts";
import type {
  DataListing,
  MarketplaceEnv,
  MarketplaceRouteContext,
  PurchaseRecord,
} from "./types.ts";

import { getLogger } from "@anchr/core-runtime/logger";
const log = getLogger(["anchr", "marketplace"]);

// Purchase log doubles as replay defense and audit trail.
const purchaseLog = new Map<string, PurchaseRecord>();

export function registerMarketplaceRoutes(
  app: Hono,
  ctx: MarketplaceRouteContext,
): void {
  const { listingStore, preimageStore, writeAuth, rateLimit } = ctx;
  const mkt = new Hono<MarketplaceEnv>();

  // Public listing response omits source_url to avoid leaking internal URLs.
  function publicListing(
    listing: DataListing,
  ): Omit<DataListing, "source_url"> {
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
    async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
      const parsed = createListingSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({
          error: "Invalid listing payload",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        }, 400);
      }
      const payload = parsed.data;
      // Validate source_url at creation, not just at fetch, to prevent storing
      // SSRF targets that GET /marketplace/listings would surface.
      const urlError = validateAttachmentUri(payload.source_url);
      if (urlError) {
        return c.json({ error: `source_url rejected: ${urlError}` }, 400);
      }

      const id = `listing_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const listing: DataListing = {
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
      };
      listingStore.set(id, listing);
      return c.json(publicListing(listing), 201);
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

  mkt.get("/data/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Listing id is required" }, 400);
    const listing = listingStore.get(id);
    if (!listing) return c.json({ error: "Listing not found" }, 404);
    if (!listing.active) {
      return c.json({ error: "Listing is no longer active" }, 410);
    }
    return c.json({
      listing_id: listing.id,
      name: listing.name,
      description: listing.description,
      price_sats: listing.price_sats,
      htlc_price_sats: listing.htlc_price_sats,
      payment_methods: ["cashu-direct", "cashu-htlc"],
      hint:
        "POST /marketplace/data/:id with X-Cashu or X-Cashu-Htlc header to purchase.",
    }, 402);
  });

  const paymentMiddleware = createPaymentMiddleware((id) =>
    listingStore.get(id)
  );

  mkt.post("/data/:id", rateLimit, paymentMiddleware, async (c) => {
    const id = c.req.param("id")!;
    const listing = listingStore.get(id)!;
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
      const fetched = await fetchWithProof(
        id,
        listing.source_url,
        listing.max_age_seconds,
      );

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
          note:
            "HTLC settlement: Oracle will verify proof and release preimage via Nostr DM.",
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
      log.error(`Fetch failed for listing ${id}:`, msg);
      return c.json(
        { error: "Failed to fetch upstream data", detail: msg },
        502,
      );
    }
  });

  mkt.post("/listings/:id/announce", rateLimit, writeAuth, async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Listing id is required" }, 400);
    const listing = listingStore.get(id);
    if (!listing) return c.json({ error: "Listing not found" }, 404);
    if (!listing.active) {
      return c.json({ error: "Cannot announce inactive listing" }, 410);
    }

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

export function _clearPurchaseLogForTest(): void {
  purchaseLog.clear();
}
